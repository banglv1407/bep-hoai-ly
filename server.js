require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const DbService = require('./db');
const { sendTelegramNotification } = require('./telegram');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'bep_nho_so_20_secret_key_2026';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'bepnho2026@admin';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(__dirname));

// Validation Helper
function isValidVietnamesePhone(phone) {
  if (!phone) return false;
  const cleanPhone = phone.replace(/[\s\-\.]/g, '');
  return /^(0|84|\+84)(3|5|7|8|9)[0-9]{8}$/.test(cleanPhone);
}

// Admin Authentication Middleware
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Yêu cầu đăng nhập Admin' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ' });
  }
}

// ----------------------------------------------------
// PUBLIC API ROUTES
// ----------------------------------------------------

// 1. Tạo đơn hàng mới từ Khách hàng / Giỏ hàng
app.post('/api/orders', async (req, res) => {
  try {
    const { customer_name, customer_phone, ctv_fb, items, total_price, note } = req.body;

    // Bắt buộc nhập Số điện thoại
    if (!customer_phone || !customer_phone.trim()) {
      return res.status(400).json({ success: false, message: 'Số điện thoại là bắt buộc!' });
    }

    const cleanPhone = customer_phone.trim();
    if (!isValidVietnamesePhone(cleanPhone)) {
      return res.status(400).json({ success: false, message: 'Số điện thoại không hợp lệ! Vui lòng nhập SĐT 10 chữ số (vd: 0987654321).' });
    }

    if (!items || (Array.isArray(items) && items.length === 0)) {
      return res.status(400).json({ success: false, message: 'Giỏ hàng đang trống!' });
    }

    // Ghi vào Database
    const newOrder = await DbService.createOrder({
      customer_name: (customer_name || '').trim() || 'Khách lẻ',
      customer_phone: cleanPhone,
      ctv_fb: ctv_fb || 'Trực tiếp Bếp',
      items,
      total_price: total_price || 0,
      note: note || ''
    });

    // Gửi thông báo qua Telegram Bot (Bất đồng bộ)
    sendTelegramNotification(newOrder).catch(err => {
      console.error('Lỗi khi gửi thông báo Telegram:', err);
    });

    return res.status(201).json({
      success: true,
      message: 'Đặt đơn hàng thành công!',
      order: newOrder
    });
  } catch (err) {
    console.error('Lỗi API POST /api/orders:', err);
    return res.status(500).json({ success: false, message: 'Lỗi hệ thống khi tạo đơn hàng: ' + err.message });
  }
});

// 2. Đăng nhập Admin
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ Tên đăng nhập và Mật khẩu' });
  }

  if (username.trim() === ADMIN_USER && password.trim() === ADMIN_PASS) {
    const token = jwt.sign({ username: ADMIN_USER, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({
      success: true,
      token,
      user: { username: ADMIN_USER, role: 'admin' }
    });
  }

  return res.status(401).json({ success: false, message: 'Tên đăng nhập hoặc mật khẩu không chính xác' });
});

// ----------------------------------------------------
// ADMIN PROTECTED API ROUTES
// ----------------------------------------------------

// 3. Lấy danh sách toàn bộ đơn hàng (Hỗ trợ lọc & tìm kiếm)
app.get('/api/admin/orders', authenticateAdmin, async (req, res) => {
  try {
    let orders = await DbService.getAllOrders();
    const { ctv, status, search, from_date, to_date } = req.query;

    // Parse JSON items if string
    orders = orders.map(o => {
      let parsedItems = o.items;
      if (typeof o.items === 'string') {
        try { parsedItems = JSON.parse(o.items); } catch(e) {}
      }
      return { ...o, items: parsedItems };
    });

    // Lọc theo CTV
    if (ctv) {
      const ctvQuery = ctv.toLowerCase().trim();
      orders = orders.filter(o => (o.ctv_fb || '').toLowerCase().includes(ctvQuery));
    }

    // Lọc theo trạng thái
    if (status && status !== 'all') {
      orders = orders.filter(o => o.status === status);
    }

    // Lọc theo từ khóa tìm kiếm (SĐT, Tên KH, Mã đơn)
    if (search) {
      const s = search.toLowerCase().trim();
      orders = orders.filter(o =>
        (o.customer_phone || '').toLowerCase().includes(s) ||
        (o.customer_name || '').toLowerCase().includes(s) ||
        (o.order_code || '').toLowerCase().includes(s)
      );
    }

    return res.json({ success: true, count: orders.length, orders });
  } catch (err) {
    console.error('Lỗi API GET /api/admin/orders:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 4. Cập nhật trạng thái đơn hàng
app.patch('/api/admin/orders/:id/status', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body;

    const validStatuses = ['pending', 'confirmed', 'shipping', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Trạng thái đơn hàng không hợp lệ' });
    }

    const updatedOrder = await DbService.updateOrderStatus(id, status, note);
    return res.json({ success: true, message: 'Cập nhật trạng thái thành công', order: updatedOrder });
  } catch (err) {
    console.error('Lỗi API PATCH /api/admin/orders/:id/status:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 5. Thống kê báo cáo doanh thu & CTV
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
  try {
    const orders = await DbService.getAllOrders();

    const totalOrders = orders.length;
    const totalRevenue = orders
      .filter(o => o.status !== 'cancelled')
      .reduce((sum, o) => sum + (o.total_price || 0), 0);

    const pendingCount = orders.filter(o => o.status === 'pending').length;
    const completedCount = orders.filter(o => o.status === 'completed').length;
    const cancelledCount = orders.filter(o => o.status === 'cancelled').length;

    // Thống kê theo CTV
    const ctvStatsMap = {};
    orders.forEach(o => {
      const ctvKey = o.ctv_fb || 'Trực tiếp Bếp';
      if (!ctvStatsMap[ctvKey]) {
        ctvStatsMap[ctvKey] = { ctv: ctvKey, orderCount: 0, revenue: 0 };
      }
      ctvStatsMap[ctvKey].orderCount += 1;
      if (o.status !== 'cancelled') {
        ctvStatsMap[ctvKey].revenue += (o.total_price || 0);
      }
    });

    const ctvList = Object.values(ctvStatsMap).sort((a, b) => b.revenue - a.revenue);

    return res.json({
      success: true,
      stats: {
        totalOrders,
        totalRevenue,
        pendingCount,
        completedCount,
        cancelledCount,
        ctvList
      }
    });
  } catch (err) {
    console.error('Lỗi API GET /api/admin/stats:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Serve index.html for root route if requested directly
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Bếp Nhỏ Số 20 Server running on port ${PORT}`);
  console.log(`🌐 Trang chủ: http://localhost:${PORT}`);
  console.log(`👑 Trang Admin: http://localhost:${PORT}/admin.html`);
  console.log(`====================================================`);
});
