const https = require('https');

async function sendTelegramNotification(order) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || '1565948270';

  if (!token || !token.trim()) {
    console.warn('----------------------------------------------------');
    console.warn('⚠️ THÔNG BÁO TELEGRAM CHƯA ĐƯỢC GỬI!');
    console.warn('👉 Nguyên nhân: Biến TELEGRAM_BOT_TOKEN trong file .env đang để trống.');
    console.warn('👉 Cách khắc phục:');
    console.warn('   1. Tạo Bot trên Telegram bằng cách nhắn tin với @BotFather (lệnh /newbot).');
    console.warn('   2. Copy chuỗi Bot Token (dạng 123456789:ABCDefgh...) dán vào TELEGRAM_BOT_TOKEN trong file .env.');
    console.warn('   3. Nhắn /start cho Bot của bạn trên Telegram để kích hoạt nhận tin nhắn.');
    console.warn('----------------------------------------------------');
    return { success: false, message: 'Chưa cấu hình TELEGRAM_BOT_TOKEN' };
  }

  try {
    let items = [];
    if (typeof order.items === 'string') {
      try { items = JSON.parse(order.items); } catch(e) {}
    } else if (Array.isArray(order.items)) {
      items = order.items;
    }

    let itemsStr = '';
    items.forEach((item, index) => {
      const itemTotal = (item.price || 0) * (item.qty || 1);
      itemsStr += `  ${index + 1}. ${item.name} (${item.unit || 'phần'}) x ${item.qty} = ${itemTotal.toLocaleString('vi-VN')}đ\n`;
    });

    const ctvStr = order.ctv_fb ? order.ctv_fb.replace('https://facebook.com/', '@') : 'Trực tiếp Bếp';
    const createdAtStr = new Date(order.created_at || Date.now()).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

    const message = `🔔 <b>ĐƠN HÀNG MỚI TỪ BẾP NHỎ SỐ 20</b>
------------------------------------
🆔 <b>Mã đơn:</b> ${order.order_code}
👤 <b>Khách hàng:</b> ${order.customer_name || 'Khách lẻ'}
📞 <b>Số điện thoại:</b> ${order.customer_phone}
💬 <b>CTV phụ trách:</b> ${ctvStr}

🛒 <b>Chi tiết bánh chọn mua:</b>
${itemsStr}
💰 <b>TỔNG THÀNH TIỀN:</b> <b>${(order.total_price || 0).toLocaleString('vi-VN')}đ</b>
------------------------------------
⏱ <b>Thời gian:</b> ${createdAtStr}`;

    const data = JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    });

    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try {
            const resp = JSON.parse(body);
            if (resp.ok) {
              console.log(`✅ Đã gửi thông báo Telegram thành công đến Chat ID ${chatId}`);
              resolve({ success: true, data: resp });
            } else {
              console.warn('----------------------------------------------------');
              console.warn('⚠️ GỬI TIN NHẮN TELEGRAM THẤT BẠI!');
              console.warn(`👉 Chi tiết lỗi từ Telegram API: ${resp.description}`);
              console.warn('👉 Hướng dẫn xử lý:');
              if (resp.description && resp.description.includes('Unauthorized')) {
                console.warn('   • Token Telegram Bot chưa đúng. Hãy kiểm tra lại TELEGRAM_BOT_TOKEN trong file .env');
              } else if (resp.description && (resp.description.includes('chat not found') || resp.description.includes('Forbidden'))) {
                console.warn(`   • Tài khoản Chat ID ${chatId} CHƯA bấm /start với Bot.`);
                console.warn('   • Vui lòng tìm tên Bot trên Telegram và bấm nút /start hoặc Send Message trước 1 lần.');
              }
              console.warn('----------------------------------------------------');
              resolve({ success: false, error: resp.description });
            }
          } catch(e) {
            resolve({ success: false, error: e.message });
          }
        });
      });

      req.on('error', (err) => {
        console.error('❌ Lỗi kết nối Telegram API:', err.message);
        resolve({ success: false, error: err.message });
      });

      req.write(data);
      req.end();
    });
  } catch (err) {
    console.error('❌ Lỗi xử lý Telegram notification:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendTelegramNotification };
