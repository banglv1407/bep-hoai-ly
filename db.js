const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'bep_orders.db');
const JSON_DB_FILE = path.join(__dirname, 'bep_orders.json');

let db = null;
let useJsonDb = false;

try {
  const sqlite3 = require('sqlite3').verbose();
  db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
      console.warn('⚠️ không thể mở SQLite database, chuyển sang lưu trữ JSON File DB:', err.message);
      useJsonDb = true;
    } else {
      console.log('✅ Kết nối SQLite database thành công:', DB_FILE);
      initTables();
    }
  });
} catch (e) {
  console.warn('⚠️ SQLite3 module không khả dụng, chuyển sang lưu trữ JSON File DB');
  useJsonDb = true;
}

function initTables() {
  if (useJsonDb || !db) return;
  const sql = `
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_code TEXT UNIQUE NOT NULL,
      customer_name TEXT,
      customer_phone TEXT NOT NULL,
      ctv_fb TEXT,
      items TEXT NOT NULL,
      total_price INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;
  db.run(sql, (err) => {
    if (err) console.error('Lỗi khởi tạo bảng orders:', err.message);
  });
}

// JSON File Database Helper
function readJsonDb() {
  if (!fs.existsSync(JSON_DB_FILE)) {
    fs.writeFileSync(JSON_DB_FILE, JSON.stringify({ orders: [] }, null, 2), 'utf8');
  }
  try {
    const raw = fs.readFileSync(JSON_DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { orders: [] };
  }
}

function writeJsonDb(data) {
  fs.writeFileSync(JSON_DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Database API Interface
const DbService = {
  createOrder: (orderData) => {
    return new Promise((resolve, reject) => {
      const now = new Date().toISOString();
      const code = 'ORD-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 100).toString().padStart(2, '0');
      const itemsJson = typeof orderData.items === 'string' ? orderData.items : JSON.stringify(orderData.items);

      if (useJsonDb || !db) {
        const data = readJsonDb();
        const newOrder = {
          id: data.orders.length ? Math.max(...data.orders.map(o => o.id || 0)) + 1 : 1,
          order_code: code,
          customer_name: orderData.customer_name || 'Khách lẻ',
          customer_phone: orderData.customer_phone,
          ctv_fb: orderData.ctv_fb || 'Trực tiếp Bếp',
          items: itemsJson,
          total_price: orderData.total_price || 0,
          status: 'pending',
          note: orderData.note || '',
          created_at: now
        };
        data.orders.unshift(newOrder);
        writeJsonDb(data);
        return resolve(newOrder);
      }

      const sql = `
        INSERT INTO orders (order_code, customer_name, customer_phone, ctv_fb, items, total_price, status, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const params = [
        code,
        orderData.customer_name || 'Khách lẻ',
        orderData.customer_phone,
        orderData.ctv_fb || 'Trực tiếp Bếp',
        itemsJson,
        orderData.total_price || 0,
        'pending',
        orderData.note || '',
        now
      ];

      db.run(sql, params, function (err) {
        if (err) return reject(err);
        DbService.getOrderById(this.lastID).then(resolve).catch(reject);
      });
    });
  },

  getOrderById: (id) => {
    return new Promise((resolve, reject) => {
      if (useJsonDb || !db) {
        const data = readJsonDb();
        const found = data.orders.find(o => o.id === parseInt(id));
        return resolve(found || null);
      }

      db.get(`SELECT * FROM orders WHERE id = ?`, [id], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  },

  getAllOrders: () => {
    return new Promise((resolve, reject) => {
      if (useJsonDb || !db) {
        const data = readJsonDb();
        return resolve(data.orders || []);
      }

      db.all(`SELECT * FROM orders ORDER BY id DESC`, [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  },

  updateOrderStatus: (id, status, note) => {
    return new Promise((resolve, reject) => {
      if (useJsonDb || !db) {
        const data = readJsonDb();
        const order = data.orders.find(o => o.id === parseInt(id));
        if (!order) return reject(new Error('Không tìm thấy đơn hàng'));
        order.status = status;
        if (note !== undefined) order.note = note;
        writeJsonDb(data);
        return resolve(order);
      }

      let sql = `UPDATE orders SET status = ? WHERE id = ?`;
      let params = [status, id];
      if (note !== undefined) {
        sql = `UPDATE orders SET status = ?, note = ? WHERE id = ?`;
        params = [status, note, id];
      }

      db.run(sql, params, function (err) {
        if (err) return reject(err);
        DbService.getOrderById(id).then(resolve).catch(reject);
      });
    });
  }
};

module.exports = DbService;
