# Backend WTP API Documentation

Dokumentasi lengkap untuk seluruh route yang terdaftar di server.

## Base URL

```bash
http://127.0.0.1:3018
```

## Auth Header

Untuk route yang butuh login:

```http
Authorization: Bearer <jwt_token>
```

## Response Wrapper

Mayoritas response dibungkus seperti ini.

### Success

```json
{
  "status": 200,
  "duration": "3.10ms",
  "data": {}
}
```

### Error

```json
{
  "status": 400,
  "duration": "1.22ms",
  "data": {
    "code": "BAD_REQUEST",
    "message": "Pesan error di sini",
    "duration": "0.55ms"
  }
}
```

---

# Route List

## Public

- `GET /health`
- `GET /health/db`
- `GET /category`
- `GET /category/sub`
- `GET /category/sub/:dynamic`
- `GET /products/list`
- `GET /products/:dynamic`
- `GET /products/flashsale`
- `GET /payments/available`
- `POST /payments/prices`
- `POST /payments/purchase/review`
- `POST /payments/purchase`
- `GET /transactions/history/:trxId`
- `GET /transactions/c/:trxId`
- `GET /site-config`
- `GET /static/uploads/:filename`
- `GET /games/supported`
- `POST /games/check-id`
- `POST /callback/payment/duitku`
- `POST /callback/agregator/digiflazz`
- `GET /leaderboard`
- `GET /promotions`
- `GET /promotions/:id`
- `POST /promotions/apply`
- `GET /badges`
- `GET /banners`
- `GET /banners/:id`
- `GET /input-types/subcategory/:subCategoryId`
- `GET /input-types/subcategory-slug/:slug`
- `POST /games/check-id`
- `POST /callback/payment/duitku`
- `POST /callback/agregator/digiflazz`
- `POST /webhook/deploy`

## Auth Required

- `GET /users/self`
- `POST /users/auth/logout`
- `GET /users/auth/logout`
- `GET /transactions/history`
- `POST /images/upload`
- `POST /aws/s3/upload`

## Seller/Admin

- `POST /products`
- `PUT /products/:productId`
- `DELETE /products/:productId`
- `POST /products/flashsale`

## Admin Only

- `POST /category`
- `POST /category/sub/:categoryId`
- `PUT /category/:categoryId`
- `DELETE /category/:categoryId`
- `PUT /category/sub/:subId`
- `DELETE /category/sub/:subId`
- `POST /products/approve`
- `POST /payments`
- `PUT /payments/:id`
- `DELETE /payments/:id`
- `GET /transactions/summary`
- `PATCH /site-config`
- `DELETE /site-config/extras/:key`
- `GET /input-types`
- `GET /input-types/:id`
- `POST /input-types`
- `PUT /input-types/:id`
- `DELETE /input-types/:id`
- `POST /promotions`
- `PUT /promotions/:id`
- `DELETE /promotions/:id`
- `GET /system-logs`
- `GET /activity-logs`
- `POST /badges`
- `PUT /badges/:id`
- `DELETE /badges/:id`
- `POST /banners`
- `PUT /banners/:id`
- `DELETE /banners/:id`

---

# 1. Health Routes

## GET /health

Cek status server.

### Success

```json
{
  "status": 200,
  "data": {
    "ok": true,
    "service": "backend-by-fennai",
    "timestamp": "2026-04-08T12:00:00.000Z",
    "uptimeSeconds": 1234
  }
}
```

## GET /health/db

Cek koneksi database.

### Success

```json
{
  "status": 200,
  "data": {
    "ok": true,
    "database": "reachable",
    "timestamp": "2026-04-08T12:00:00.000Z"
  }
}
```

### Error

```json
{
  "status": 500,
  "data": {
    "ok": false,
    "database": "unreachable",
    "timestamp": "2026-04-08T12:00:00.000Z"
  }
}
```

---

# 2. User Routes

## POST /users/auth/register

Register user baru.

### Body

```json
{
  "email": "user@gmail.com",
  "displayName": "Aiden User",
  "password": "12345678",
  "loginProvider": "email",
  "role": "buyer"
}
```

### Success

```json
{
  "status": 201,
  "data": {
    "id": "session-id",
    "userId": "user-id",
    "jwtToken": "jwt-token",
    "lastSeenAt": "2026-04-08T12:00:00.000Z"
  }
}
```

### Error

```json
{
  "status": 409,
  "data": {
    "message": "Mohon gunakan email lain yang belum pernah digunakan sebelumnya."
  }
}
```

## POST /users/auth/login

Login user.

### Body

```json
{
  "email": "bento01@gmail.com",
  "password": "12345678"
}
```

### Success

```json
{
  "status": 200,
  "data": {
    "id": "session-id",
    "userId": "user-id",
    "jwtToken": "jwt-token"
  }
}
```

### Error

```json
{
  "status": 401,
  "data": {
    "message": "Email atau password yang Anda masukan salah."
  }
}
```

## POST /users/auth/logout

Logout session aktif.

### Header

```http
Authorization: Bearer <jwt_token>
```

### Success

```json
{
  "status": 200,
  "data": {
    "message": "Logout successful."
  }
}
```

## GET /users/auth/logout

Versi GET untuk logout, behavior sama seperti POST.

## GET /users/self

Ambil data user login.

### Success

```json
{
  "status": 200,
  "data": {
    "id": "user-id",
    "email": "bento01@gmail.com",
    "displayName": "Nama Ku Bento",
    "role": "admin"
  }
}
```

### Error

```json
{
  "status": 401,
  "data": {
    "message": "Unauthorized"
  }
}
```

---

# 3. Category Routes

## GET /category

Ambil semua category beserta subcategory.

## GET /category/sub

Ambil semua subcategory.

## GET /category/sub/:dynamic

Ambil subcategory berdasarkan `categoryId` atau `slug`.

### Query

- `productInclude=true` untuk ikutkan produk aktif

### Error

```json
{
  "status": 404,
  "data": {
    "message": "No sub-categories found for the given parameter."
  }
}
```

## POST /category

Admin only, buat category baru.

### Body

```json
{
  "title": "Voucher"
}
```

## POST /category/sub/:categoryId

Admin only, buat subcategory baru.

### Body

```json
{
  "title": "Mobile Legends",
  "thumbnail": "https://example.com/ml.png",
  "description": "Topup ML",
  "banners": ["https://example.com/banner.png"],
  "brand": "Moonton"
}
```

## PUT /category/:categoryId

Admin only, update category.

### Body

```json
{
  "title": "Voucher Game"
}
```

## DELETE /category/:categoryId

Admin only, hapus category dan subcategory terkait.

## PUT /category/sub/:subId

Admin only, update subcategory.

### Body

```json
{
  "title": "Free Fire",
  "categoryId": "category-id",
  "thumbnail": "https://example.com/ff.png",
  "description": "Topup FF",
  "banners": ["https://example.com/banner.png"],
  "brand": "Garena"
}
```

## DELETE /category/sub/:subId

Admin only, hapus subcategory.

---

# 4. Product Routes

## GET /products/list

List produk.

### Query Optional

- `q`
- `id`
- `category`
- `sub`
- `status`
- `sort=latest|oldest|low_price|high_price`
- `page`
- `limit`

### Success

```json
{
  "status": 200,
  "data": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "items": [
      {
        "id": "product-id",
        "title": "144 Diamond",
        "slug": "144-diamond",
        "price": "55000",
        "status": "PUBLISHED"
      }
    ]
  }
}
```

## GET /products/:dynamic

Detail produk by `id` atau `slug`.

## POST /products

Seller/Admin only.

### Body

```json
{
  "title": "86 Diamond",
  "description": "Produk topup",
  "subCategoryId": "subcategory-id",
  "price": 20000,
  "currency": "IDR",
  "stock": 10,
  "thumbnails": "https://example.com/image.png",
  "conditionNotes": "Fast process",
  "special": true
}
```

## PUT /products/:productId

Update product milik sendiri atau admin.

## DELETE /products/:productId

Hapus product milik sendiri atau admin.

## POST /products/approve

Admin only, approve product draft.

### Body

```json
{
  "productId": "product-id"
}
```

## POST /products/flashsale

Seller/Admin only, buat flash sale.

### Body

```json
{
  "productId": "product-id",
  "discount": 5000,
  "discType": "flat"
}
```

## GET /products/flashsale

Ambil daftar flash sale aktif.

---

# 5. Payment Routes

## GET /payments/available

Ambil payment method.

- buyer/public: hanya yang `active`
- admin: semua payment method

## POST /payments

Admin only, buat payment method.

### Body

```json
{
  "methodCode": "QRIS",
  "paymentName": "QRIS Baru",
  "source": "DUITKU",
  "thumbnail": "https://example.com/qris.png",
  "feeType": "percent",
  "feeValue": 0.7,
  "paymentVisibility": "active",
  "group": "qris"
}
```

### Success

```json
{
  "status": 201,
  "data": {
    "id": 7,
    "methodCode": "QRIS",
    "paymentName": "QRIS Baru"
  }
}
```

## PUT /payments/:id

Admin only, update payment method.

### Body

```json
{
  "paymentName": "QRIS Updated",
  "feeValue": 1
}
```

## DELETE /payments/:id

Admin only, hapus payment method.

### Error

```json
{
  "status": 409,
  "data": {
    "message": "Payment method is already used by transactions and cannot be deleted."
  }
}
```

## POST /payments/prices

Hitung harga semua payment method aktif.

### Body

```json
{
  "itemId": "product-id",
  "qty": 1,
  "flashId": 1
}
```

### Error

```json
{
  "status": 400,
  "data": {
    "message": "Produk flash sale hanya dapat dibeli 1 per transaksi"
  }
}
```

## POST /payments/purchase/review

Preview pembelian.

### Body

```json
{
  "itemId": "product-id",
  "paymentMethod": 3,
  "qty": 1,
  "userData": {
    "primary_id": "12345678",
    "server_id": "1234"
  },
  "flashId": 1
}
```

## POST /payments/purchase

Buat transaksi pembayaran.

### Body

```json
{
  "itemId": "product-id",
  "paymentMethod": 3,
  "qty": 1,
  "email": "buyer@gmail.com",
  "phoneNumber": "08123456789",
  "userData": {
    "primary_id": "12345678",
    "server_id": "1234"
  },
  "flashId": 1
}
```

### Notes

- `email` wajib
- `phoneNumber` opsional
- `qty` maksimal 10
- kalau flash sale, `qty` harus 1

---

# 6. Transaction Routes

## GET /transactions/history/:trxId

Ambil detail transaksi by trxId.

## GET /transactions/c/:trxId

Cek apakah transaksi ada.

### Success

```json
{
  "status": 200,
  "data": {
    "count": 1
  }
}
```

## GET /transactions/history

Butuh login.

- admin bisa lihat semua
- non-admin cuma lihat transaksi sendiri

### Query Optional

- `trxId`
- `paymentStatus`
- `orderStatus`
- `userId`
- `createdAtSort=asc|desc`
- `search`
- `page`
- `limit`

## GET /transactions/summary

Admin only.

### Query Optional

- `from`
- `to`

---

# 7. Site Config Routes

## GET /site-config

Ambil site config publik, extra secret akan dimasking.

## PATCH /site-config

Admin only.

### Body

```json
{
  "siteName": "WTPANJAY",
  "siteUrl": "https://wtpanjay.com",
  "contactEmail": "admin@wtpanjay.com",
  "extras": [
    {
      "key": "midtrans_server_key",
      "value": "secret-value",
      "description": "secret key",
      "isSecret": true
    }
  ]
}
```

## DELETE /site-config/extras/:key

Admin only, hapus extra config tertentu.

---

# 8. Upload Routes

## POST /images/upload

Upload gambar ke local storage.

### Header

```http
Authorization: Bearer <jwt_token>
Content-Type: multipart/form-data
```

### Rules

- mime allowed: `image/png`, `image/jpeg`, `image/webp`
- max size: `5 MB`

## POST /aws/s3/upload

Upload gambar ke S3.

### Rules

- mime allowed: `image/png`, `image/jpeg`, `image/webp`
- max size: `5 MB`

## GET /static/uploads/:filename

Ambil file upload lokal.

### Error

```json
{
  "status": 404,
  "data": {
    "message": "File not found"
  }
}
```

---

# 9. Game Check Routes

## GET /games/supported

Ambil daftar game yang didukung.

### Success

```json
{
  "status": 200,
  "data": [
    {
      "code": "mobile-legends",
      "name": "Mobile Legends"
    }
  ]
}
```

## POST /games/check-id

Cek user ID game.

### Body

```json
{
  "game": "mobile-legends",
  "userId": "12345678",
  "zoneId": "1234"
}
```

### Error

```json
{
  "status": 400,
  "data": {
    "message": "game is required. Use GET /games/supported to see available games."
  }
}
```

````

---

# 10. Callback Routes

## POST /callback/payment/duitku
Callback dari Duitku.

### Success
```json
{
  "status": 200,
  "data": {
    "message": "OK"
  }
}
````

### Error

```json
{
  "status": 401,
  "data": {
    "message": "Invalid signature"
  }
}
```

## POST /callback/agregator/digiflazz

Callback dari Digiflazz.

### Success

```json
{
  "status": 200,
  "data": {
    "message": "OK"
  }
}
```

---

# 11. Input Types Routes

## GET /input-types

Admin only. List semua input types.

### Query Optional

- `subCategoryId` - filter by subcategory

### Success

```json
{
  "status": 200,
  "data": [
    {
      "id": 1,
      "name": "user_id",
      "label": "User ID",
      "type": "text",
      "model": "input",
      "placeholder": "Masukkan User ID",
      "options": null,
      "icon": "user",
      "maskingForView": false,
      "subCategoryId": "uuid",
      "createdAt": "2026-04-18T12:00:00.000Z",
      "subCategory": {
        "id": "subcategory-id",
        "title": "Mobile Legends",
        "slug": "mobile-legends"
      }
    }
  ]
}
```

### Error

```json
{
  "status": 403,
  "data": {
    "message": "Forbidden"
  }
}
```

## GET /input-types/:id

Admin only. Detail input type.

### Success

```json
{
  "status": 200,
  "data": {
    "id": 1,
    "name": "user_id",
    "label": "User ID",
    "type": "text",
    "model": "input",
    "placeholder": "Masukkan User ID",
    "options": null,
    "icon": "user",
    "maskingForView": false,
    "subCategoryId": "uuid",
    "createdAt": "2026-04-18T12:00:00.000Z"
  }
}
```

### Error

```json
{
  "status": 404,
  "data": {
    "message": "Input type not found"
  }
}
```

## POST /input-types

Admin only. Create input type.

### Body

```json
{
  "name": "user_id",
  "label": "User ID",
  "type": "text",
  "model": "input",
  "placeholder": "Masukkan User ID",
  "options": null,
  "icon": "user",
  "maskingForView": false,
  "subCategoryId": "uuid"
}
```

### Success

```json
{
  "status": 201,
  "data": {
    "id": 1,
    "name": "user_id",
    "label": "User ID",
    "type": "text",
    "model": "input",
    "placeholder": "Masukkan User ID",
    "options": null,
    "icon": "user",
    "maskingForView": false,
    "subCategoryId": "uuid",
    "createdAt": "2026-04-18T12:00:00.000Z"
  }
}
```

### Error

```json
{
  "status": 400,
  "data": {
    "message": "Validation error",
    "errors": {
      "subCategoryId": "SubCategory not found"
    }
  }
}
```

## PUT /input-types/:id

Admin only. Update input type.

### Body

```json
{
  "label": "Player ID",
  "placeholder": "Masukkan Player ID"
}
```

### Success

```json
{
  "status": 200,
  "data": {
    "id": 1,
    "name": "user_id",
    "label": "Player ID",
    "type": "text",
    "model": "input",
    "placeholder": "Masukkan Player ID",
    "options": null,
    "icon": "user",
    "maskingForView": false,
    "subCategoryId": "uuid",
    "createdAt": "2026-04-18T12:00:00.000Z"
  }
}
```

### Error

```json
{
  "status": 404,
  "data": {
    "message": "Input type not found"
  }
}
```

## DELETE /input-types/:id

Admin only. Delete input type.

### Success

```json
{
  "status": 200,
  "data": {
    "message": "Input type deleted successfully"
  }
}
```

### Error

```json
{
  "status": 404,
  "data": {
    "message": "Input type not found"
  }
}
```

## GET /input-types/subcategory/:subCategoryId

Public. Ambil input types berdasarkan subcategory ID.

### Success

```json
{
  "status": 200,
  "data": [
    {
      "called": "user_id",
      "label": "User ID",
      "type": "text",
      "model": "input",
      "placeholder": "Masukkan User ID",
      "options": null,
      "icon": "user",
      "maskingForView": false,
      "createdAt": "2026-04-18T12:00:00.000Z"
    }
  ]
}
```

### Error

```json
{
  "status": 404,
  "data": {
    "message": "SubCategory not found"
  }
}
```

## GET /input-types/subcategory-slug/:slug

Public. Ambil input types berdasarkan subcategory slug.

### Success

```json
{
  "status": 200,
  "data": [
    {
      "id": 1,
      "name": "user_id",
      "label": "User ID",
      "type": "text",
      "model": "input",
      "placeholder": "Masukkan User ID",
      "options": null,
      "icon": "user",
      "maskingForView": false,
      "createdAt": "2026-04-18T12:00:00.000Z"
    }
  ]
}
```

### Error

```json
{
  "status": 404,
  "data": {
    "message": "SubCategory not found"
  }
}
```

---

# 12. Leaderboard Routes

## GET /leaderboard

Public. Ambil leaderboard untuk hari ini, minggu ini, bulan ini.

### Success

```json
{
  "status": 200,
  "data": {
    "today": [
      {
        "key": "buyer-id",
        "buyerName": "Aiden",
        "productTitle": "144 Diamond",
        "totalAmount": 55000,
        "totalOrders": 1,
        "totalQuantity": 1,
        "lastCreatedAt": "2026-04-18T12:00:00.000Z"
      }
    ],
    "week": [],
    "month": [],
    "updatedAt": "2026-04-18T12:00:00.000Z"
  }
}
```

---

# 13. Promotion Routes

## GET /promotions

Public. List semua promo.

### Success

```json
{
  "status": 200,
  "data": [
    {
      "id": 1,
      "code": "DISKON10",
      "title": "Diskon 10%",
      "productId": null,
      "categoryId": null,
      "subCategoryId": null,
      "active": true,
      "allowFlashSale": false,
      "maxUse": 5,
      "used": 0,
      "discType": "percent",
      "value": 10,
      "minTrx": 1000,
      "maxDiscount": 5000,
      "userId": null,
      "expiredDate": "2026-05-01T00:00:00.000Z",
      "createdAt": "2026-04-18T12:00:00.000Z"
    }
  ]
}
```

## GET /promotions/:id

Public. Detail promo.

### Success

```json
{
  "status": 200,
  "data1": {
    "id": 1,
    "code": "DISKON10",
    "title": "Diskon 10%",
    "productId": null,
    "categoryId": null,
    "subCategoryId": null,
    "active": true,
    "allowFlashSale": false,
    "maxUse": 5,
    "used": 0,
    "discType": "percent",
    "value": 10,
    "minTrx": 1000,
    "maxDiscount": 5000,
    "userId": null,
    "expiredDate": "2026-05-01T00:00:00.000Z",
    "createdAt": "2026-04-18T12:00:00.000Z"
  }
}
```

### Error

```json
{
  "status": 404,
  "data": {
    "message": "Promotion tidak ditemukan."
  }
}
```

## POST /promotions/apply

Public. Apply promo code.

### Body

```json
{
  "id": 1,
  "itemId": "product-id",
  "flashId": 1
}
```

### Success

```json
{
  "status": 200,
  "data": {
    "message": "Kode promo berhasil di gunakan."
  }
}
```

### Error

```json
{
  "status": 406,
  "data": {
    "message": "Tidak bisa digabung flash sale."
  }
}
```

### Notes

- Flash sale product tidak bisa pakai promo yang tidak allowFlashSale

## POST /promotions

Admin only. Create promo.

### Body

```json
{
  "code": "DISKON10",
  "title": "Diskon 10%",
  "productId": "",
  "categoryId": "",
  "subCategoryId": "",
  "active": true,
  "allowFlashSale": false,
  "maxUse": 5,
  "used": 0,
  "discType": "percent",
  "value": 10,
  "minTrx": 1000,
  "maxDiscount": 5000,
  "userId": "",
  "expiredDate": "2026-05-01"
}
```

### Success

```json
{
  "status": 201,
  "data": {
    "message": "Promotion berhasil dibuat.",
    "promotion": {
      "id": 1,
      "code": "DISKON10",
      "title": "Diskon 10%",
      "productId": null,
      "categoryId": null,
      "subCategoryId": null,
      "active": true,
      "allowFlashSale": false,
      "maxUse": 5,
      "used": 0,
      "discType": "percent",
      "value": 10,
      "minTrx": 1000,
      "maxDiscount": 5000,
      "userId": null,
      "expiredDate": "2026-05-01T00:00:00.000Z",
      "createdAt": "2026-04-18T12:00:00.000Z"
    }
  }
}
```

### Error

```json
{
  "status": 409,
  "data": {
    "message": "Kode promo sudah ada."
  }
}
```

## PUT /promotions/:id

Admin only. Update promo.

### Body

```json
{
  "title": "Diskon 15%",
  "value": 15,
  "maxDiscount": 10000
}
```

### Success

```json
{
  "status": 200,
  "data": {
    "message": "Promotion berhasil diperbarui.",
    "promotion": {
      "id": 1,
      "code": "DISKON10",
      "title": "Diskon 15%",
      "productId": null,
      "categoryId": null,
      "subCategoryId": null,
      "active": true,
      "allowFlashSale": false,
      "maxUse": 5,
      "used": 0,
      "discType": "percent",
      "value": 15,
      "minTrx": 1000,
      "maxDiscount": 10000,
      "userId": null,
      "expiredDate": "2026-05-01T00:00:00.000Z",
      "createdAt": "2026-04-18T12:00:00.000Z"
    }
  }
}
```

### Error

```json
{
  "status": 404,
  "data": {
    "message": "Promotion tidak ditemukan."
  }
}
```

## DELETE /promotions/:id

Admin only. Delete promo.

### Success

```json
{
  "status": 200,
  "data": {
    "message": "Promotion berhasil dihapus."
  }
}
```

### Error

```json
{
  "status": 404,
  "data": {
    "message": "Promotion tidak ditemukan."
  }
}
```

---

# 14. System Log Routes

## GET /system-logs

Admin only. System logs dengan pagination.

### Query Optional

- `page`
- `limit`
- `type`
- `source`
- `provider`
- `trxId`
- `search`

### Success

```json
{
  "status": 200,
  "data": {
    "items": [
      {
        "id": 1,
        "type": "payment",
        "source": "duitku",
        "provider": "DUITKU",
        "trxId": "TRX-123",
        "url": "https://callback",
        "message": "Payment successful",
        "createdAt": "2026-04-18T12:00:00.000Z"
      }
    ],
    "meta": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "totalPages": 5
    }
  }
}
```

### Error

```json
{
  "status": 403,
  "data": {
    "message": "Forbidden"
  }
}
```

---

# 15. Activity Log Routes

## GET /activity-logs

Admin only. Activity logs dengan pagination.

### Query Optional

- `page`
- `limit`
- `action`
- `entityType`
- `search`

### Success

```json
{
  "status": 200,
  "data": {
    "items": [
      {
        "id": 1,
        "actorName": "admin",
        "action": "CREATE",
        "entityType": "product",
        "entityLabel": "144 Diamond",
        "description": "Product created",
        "createdAt": "2026-04-18T12:00:00.000Z"
      }
    ],
    "meta": {
      "page": 1,
      "limit": 20,
      "total": 50,
      "totalPages": 3
    }
  }
}
```

### Error

```json
{
  "status": 403,
  "data": {
    "message": "Forbidden"
  }
}
```

---

# 16. Badge Routes

## GET /badges

Public. List semua badges.

### Success

```json
{
  "status": 200,
  "data": [
    {
      "id": 1,
      "label": "Featured",
      "color": "#f5c518",
      "createdAt": "2026-04-18T12:00:00.000Z"
    }
  ]
}
```

## POST /badges

Admin only. Create badge.

### Body

```json
{
  "label": "Featured",
  "color": "#f5c518"
}
```

### Success

```json
{
  "status": 201,
  "data": {
    "message": "Badge berhasil dibuat.",
    "id": 1,
    "label": "Featured",
    "color": "#f5c518",
    "createdAt": "2026-04-18T12:00:00.000Z"
  }
}
```

### Error

```json
{
  "status": 400,
  "data": {
    "message": "Label wajib diisi."
  }
}
```

## PUT /badges/:id

Admin only. Update badge.

### Body

```json
{
  "label": "Popular",
  "color": "#ff0000"
}
```

### Success

```json
{
  "status": 200,
  "data": {
    "message": "Badge berhasil diupdate.",
    "id": 1,
    "label": "Popular",
    "color": "#ff0000",
    "createdAt": "2026-04-18T12:00:00.000Z"
  }
}
```

### Error

```json
{
  "status": 404,
  "data": {
    "message": "Badge tidak ditemukan."
  }
}
```

## DELETE /badges/:id

Admin only. Delete badge.

### Success

```json
{
  "status": 200,
  "data": {
    "message": "Badge berhasil dihapus."
  }
}
```

### Error

```json
{
  "status": 404,
  "data": {
    "message": "Badge tidak ditemukan."
  }
}
```

---

# 17. Banner Routes

## GET /banners

Public. List semua banners (filterable by type).

### Query Optional

- `type` - "popup" atau "banner"

### Success

```json
{
  "status": 200,
  "data": [
    {
      "id": 1,
      "title": "Welcome Banner",
      "imageUrl": "https://example.com/banner.png",
      "type": "banner",
      "clickUrl": "https://example.com",
      "createdAt": "2026-04-18T12:00:00.000Z"
    }
  ]
}
```

## GET /banners/:id

Public. Detail banner.

### Success

```json
{
  "status": 200,
  "data": {
    "id": 1,
    "title": "Welcome Banner",
    "imageUrl": "https://example.com/banner.png",
    "type": "banner",
    "clickUrl": "https://example.com",
    "createdAt": "2026-04-18T12:00:00.000Z"
  }
}
```

### Error

```json
{
  "status": 404,
  "data": {
    "message": "Banner tidak ditemukan."
  }
}
```

## POST /banners

Admin only. Create banner.

### Body

```json
{
  "title": "Welcome Banner",
  "imageUrl": "https://example.com/banner.png",
  "type": "banner",
  "clickUrl": "https://example.com"
}
```

### Success

```json
{
  "status": 201,
  "data": {
    "message": "Banner berhasil dibuat.",
    "banner": {
      "id": 1,
      "title": "Welcome Banner",
      "imageUrl": "https://example.com/banner.png",
      "type": "banner",
      "clickUrl": "https://example.com",
      "createdAt": "2026-04-18T12:00:00.000Z"
    }
  }
}
```

### Error

```json
{
  "status": 400,
  "data": {
    "message": "Validasi gagal.",
    "errors": {
      "title": "Title wajib diisi"
    }
  }
}
```

## PUT /banners/:id

Admin only. Update banner.

### Body

```json
{
  "title": "Summer Sale Banner",
  "clickUrl": "https://example.com/summer"
}
```

### Success

```json
{
  "status": 200,
  "data": {
    "message": "Banner berhasil diperbarui.",
    "banner": {
      "id": 1,
      "title": "Summer Sale Banner",
      "imageUrl": "https://example.com/banner.png",
      "type": "banner",
      "clickUrl": "https://example.com/summer",
      "createdAt": "2026-04-18T12:00:00.000Z"
    }
  }
}
```

### Error

```json
{
  "status": 404,
  "data": {
    "message": "Banner tidak ditemukan."
  }
}
```

## DELETE /banners/:id

Admin only. Delete banner.

### Success

```json
{
  "status": 200,
  "data": {
    "message": "Banner berhasil dihapus."
  }
}
```

### Error

```json
{
  "status": 404,
  "data": {
    "message": "Banner tidak ditemukan."
  }
}
```

---

# 11. GitHub Webhook Route

# Article Routes

## Public
- `GET /articles` - List articles with pagination and filter (category, tag, status, search)
- `GET /articles/:id` - Get article by ID
- `GET /articles/slug/:slug` - Get article by slug
- `GET /article-categories` - List all article categories
- `GET /article-categories/:id` - Get category by ID
- `GET /article-categories/slug/:slug` - Get category by slug
- `GET /article-tags` - List all tags
- `GET /article-tags/:id` - Get tag by ID
- `GET /article-tags/slug/:slug` - Get tag by slug
- `GET /articles/:articleId/comments` - Get comments for article with pagination

## Auth Required
- `POST /articles/:id/like` - Like/unlike article (requires body: `{}`)
- `POST /articles/:id/bookmark` - Bookmark/unbookmark article (requires body: `{}`)
- `POST /articles/:articleId/comments` - Add comment to article
- `PUT /articles/comments/:id` - Update comment (own or admin)
- `DELETE /articles/comments/:id` - Delete comment (own or admin)

## Admin Only
- `POST /articles` - Create new article
- `PUT /articles/:id` - Update article
- `DELETE /articles/:id` - Delete article
- `POST /article-categories` - Create new category
- `PUT /article-categories/:id` - Update category
- `DELETE /article-categories/:id` - Delete category
- `POST /article-tags` - Create new tag
- `PUT /article-tags/:id` - Update tag
- `DELETE /article-tags/:id` - Delete tag

---

# 18. Article Routes Detail

## GET /articles
Get list of articles with pagination and filtering.

### Query Params
- `page` (default: 1) - Page number
- `limit` (default: 20, max: 100) - Items per page
- `categoryId` - Filter by category UUID
- `tagId` - Filter by tag UUID
- `status` - Filter by status (DRAFT/PUBLISHED/ARCHIVED) - admin only
- `featured` - Filter featured articles (true/false)
- `pinned` - Filter pinned articles (true/false)
- `search` - Search in title, excerpt, content, meta fields
- `authorId` - Filter by author UUID

### Success
```json
{
  "status": 200,
  "data": {
    "items": [
      {
        "id": "793a1a62-30c2-4670-b3cf-8c0bead2e844",
        "title": "Belajar React JS",
        "slug": "belajar-react-js-pemula",
        "excerpt": "Pandu lengkap belajar React JS",
        "thumbnail": null,
        "status": "PUBLISHED",
        "publishedAt": "2026-04-18T15:19:24.954Z",
        "createdAt": "2026-04-18T15:19:24.956Z",
        "views": 1,
        "likesCount": 1,
        "commentsCount": 1,
        "featured": false,
        "pinned": false,
        "author": {
          "id": "user-id",
          "email": "admin@wtp.com",
          "displayName": "Admin WTP"
        },
        "category": {
          "id": "cat-id",
          "name": "Technology & Programming",
          "slug": "technology"
        },
        "tags": [
          {
            "tag": {
              "id": "tag-id",
              "name": "Tutorial",
              "slug": "tutorial",
              "color": "#ff5722"
            }
          }
        ]
      }
    ],
    "meta": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

## GET /articles/slug/:slug
Get article detail by slug.

### Success
```json
{
  "status": 200,
  "data": {
    "id": "793a1a62-30c2-4670-b3cf-8c0bead2e844",
    "title": "Belajar React JS untuk Pemula",
    "slug": "belajar-react-js-pemula",
    "content": "React JS adalah library JavaScript yang powerful...",
    "excerpt": "Pandu lengkap belajar React JS dari nol hingga mahir",
    "thumbnail": null,
    "authorId": "371e7000-8d20-4948-a3a0-019eb53b0d82",
    "status": "PUBLISHED",
    "publishedAt": "2026-04-18T15:19:24.954Z",
    "createdAt": "2026-04-18T15:19:24.956Z",
    "updatedAt": "2026-04-18T15:21:26.732Z",
    "metaTitle": null,
    "metaDescription": null,
    "metaKeywords": null,
    "ogImage": null,
    "readingTime": 0,
    "featuredImages": null,
    "categoryId": "ba1dba98-48c8-4f06-9c9a-71f3eb43bd25",
    "views": 1,
    "likesCount": 1,
    "commentsCount": 1,
    "featured": false,
    "pinned": false,
    "author": {
      "id": "371e7000-8d20-4948-a3a0-019eb53b0d82",
      "email": "admin@wtp.com",
      "displayName": "Admin WTP",
      "createdAt": "2026-04-18T15:17:13.251Z"
    },
    "category": {
      "id": "ba1dba98-48c8-4f06-9c9a-71f3eb43bd25",
      "name": "Technology & Programming",
      "slug": "technology",
      "thumbnail": null
    },
    "tags": [
      {
        "articleId": "793a1a62-30c2-4670-b3cf-8c0bead2e844",
        "tagId": "feea41c3-4b87-4d56-baea-afdafe6485b9",
        "createdAt": "2026-04-18T15:19:25.232Z",
        "tag": {
          "id": "feea41c3-4b87-4d56-baea-afdafe6485b9",
          "name": "Tutorial",
          "slug": "tutorial",
          "color": "#ff5722",
          "description": "Panduan belajar"
        }
      }
    ],
    "comments": [...],
    "likes": [...],
    "bookmarks": []
  }
}
```

## POST /articles
Create new article (admin only).

### Body
```json
{
  "title": "Belajar React JS untuk Pemula",
  "slug": "belajar-react-js-pemula",
  "content": "React JS adalah library JavaScript yang powerful...",
  "excerpt": "Pandu lengkap belajar React JS",
  "thumbnail": "https://example.com/thumb.jpg",
  "categoryId": "ba1dba98-48c8-4f06-9c9a-71f3eb43bd25",
  "status": "PUBLISHED",
  "metaTitle": "Custom SEO Title",
  "metaDescription": "Custom SEO description",
  "metaKeywords": "react, javascript, tutorial",
  "ogImage": "https://example.com/og.jpg",
  "tags": ["feea41c3-4b87-4d56-baea-afdafe6485b9"]
}
```

### Success
```json
{
  "status": 201,
  "data": {
    "message": "Article berhasil dibuat.",
    "article": {...}
  }
}
```

### Error
```json
{
  "status": 409,
  "data": {
    "message": "Slug sudah digunakan."
  }
}
```

## PUT /articles/:id
Update article (admin only).

### Body
Same as POST but all fields are optional.

## DELETE /articles/:id
Delete article (admin only).

### Success
```json
{
  "status": 200,
  "data": {
    "message": "Article berhasil dihapus."
  }
}
```

## POST /articles/:id/like
Like or unlike an article (auth required).

### Body
```json
{}
```

### Success
```json
{
  "status": 200,
  "data": {
    "message": "Article berhasil dilike.",
    "liked": true
  }
}
```

### Unlike Response
```json
{
  "status": 200,
  "data": {
    "message": "Like berhasil dihapus.",
    "liked": false
  }
}
```

## POST /articles/:id/bookmark
Bookmark or unbookmark an article (auth required).

### Body
```json
{}
```

### Success
```json
{
  "status": 200,
  "data": {
    "message": "Article berhasil bookmark.",
    "bookmarked": true
  }
}
```

## POST /articles/:articleId/comments
Add comment to article (auth required).

### Body
```json
{
  "content": "Artikel yang sangat bermanfaat!",
  "parentId": "optional-comment-id-for-reply"
}
```

### Success
```json
{
  "status": 201,
  "data": {
    "message": "Comment berhasil dibuat.",
    "comment": {
      "id": "5e9e8c04-7d11-48e0-8f66-12c5d68af51c",
      "articleId": "793a1a62-30c2-4670-b3cf-8c0bead2e844",
      "userId": "371e7000-8d20-4948-a3a0-019eb53b0d82",
      "content": "Artikel yang sangat bermanfaat!",
      "parentId": null,
      "createdAt": "2026-04-18T15:20:35.447Z",
      "user": {
        "id": "371e7000-8d20-4948-a3a0-019eb53b0d82",
        "displayName": "Admin WTP"
      },
      "replies": []
    }
  }
}
```

## GET /articles/:articleId/comments
Get comments for article with pagination.

### Query Params
- `page` (default: 1)
- `limit` (default: 20)
- `parentId` - Filter replies for specific comment

### Success
```json
{
  "status": 200,
  "data": {
    "items": [...],
    "meta": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

## PUT /articles/comments/:id
Update comment (owner or admin only).

## DELETE /articles/comments/:id
Delete comment and all its replies (owner or admin only).

---

## Article Category Routes

### POST /article-categories
Create new category (admin only).

### Body
```json
{
  "name": "Technology & Programming",
  "slug": "technology-programming",
  "description": "Artikel tentang teknologi dan pemrograman",
  "thumbnail": "https://example.com/cat-thumb.jpg"
}
```

### PUT /article-categories/:id
Update category (admin only).

### DELETE /article-categories/:id
Delete category (admin only). Cannot delete if still has articles.

---

## Article Tag Routes

### POST /article-tags
Create new tag (admin only).

### Body
```json
{
  "name": "Tutorial",
  "slug": "tutorial",
  "description": "Panduan belajar step by step",
  "color": "#ff5722",
  "featured": false
}
```

### PUT /article-tags/:id
Update tag (admin only).

### DELETE /article-tags/:id
Delete tag (admin only). Cannot delete if still used by articles.

---

# 11. GitHub Webhook Route

## POST /webhook/deploy

Webhook deploy dari GitHub.

### Required Header

- `x-hub-signature-256`
- `x-github-event: push`

### Success

```json
{
  "status": 200,
  "data": {
    "status": "Deploy triggered",
    "time": "2026-04-08T12:00:00.000Z",
    "message": "Deploy triggered for repo: backend-wtp, branch: refs/heads/main, by: username"
  }
}
```

### Error

```json
{
  "status": 401,
  "data": {
    "error": "Invalid signature"
  }
}
```

---

# Important Notes

## Payment Rules

- `email` wajib di `/payments/purchase`
- `phoneNumber` opsional
- payment method nonaktif tidak bisa dipakai buyer
- produk flash sale hanya boleh `qty = 1`

## Upload Rules

- file type: png, jpg, jpeg, webp
- max size 5 MB

## Auth Rules

- role tidak sesuai akan kena `403`
- token invalid / expired akan gagal auth

## Env yang penting

Minimal env yang perlu disiapkan:

- `PORT`
- `DATABASE_URL`
- `JWT_SECRET`
- `MERCH_ID`
- `API_KEY_DUITKU`
- `DUITKU_CALLBACK_URL`
- `DUITKU_RETURN_URL`
- `DIGIFLAZZ_WEBHOOK_SECRET`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_ALLOWED_REPO`
- `GITHUB_ALLOWED_BRANCH`
- `GITHUB_DEPLOY_COMMAND`
