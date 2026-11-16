全好蔬果｜第八階段 店家登入帳號整合版

部署位置：Cloudflare Workers > quan-hao-test > New deployment > Upload static files
請上傳本資料夾內的：index.html、quote.html、customer.html、stores.html、assets 資料夾及 README.txt。

本階段更新：
- 店家管理新增店家時，可同時設定店家登入 Email 與初始密碼。
- 前端透過 Cloudflare Worker API 建立 Supabase Auth 帳號。
- 新帳號自動設定 profiles.role = customer。
- 新帳號自動綁定剛新增的店家 customer_store_accounts。
- 帳號建立成功後，店家可使用登入 Email 與初始密碼登入查詢自己的報價單。
- 編輯既有店家時仍只修改店家聯絡資料，不會重建登入帳號。
- 若登入帳號建立失敗，新店家資料會自動設為停用，避免留下可用但沒有登入帳號的店家。

API：
https://quan-hao-account-api.jay2461325.workers.dev/create-customer-account

安全注意：
- Supabase service role key 僅存放在 Cloudflare Worker Secret，不得放入前端檔案。
- 本前端只呼叫 API 並傳送目前管理者的登入 access token。
- 店家帳號建立 API 會在後端再次確認呼叫者 profiles.role 必須為 admin。
- 初始密碼只在建立帳號時送往後端，不會寫入店家資料表。
- 本版前端 CORS 允許來源為 https://quan-hao-test.jay2461325.workers.dev。

重要：
- 請只部署至測試 Worker：quan-hao-test。
- 不要覆蓋正式網站 Worker：quan-hao-login。
- API Worker 為 quan-hao-account-api，請勿將靜態網站檔案部署到 API Worker。

本次介面調整：
- 報價工作區上方移除「店家資料庫」按鈕；店家資料仍由獨立的店家管理頁面維護。
- 管理者與員工工作首頁的「報價紀錄」卡片已連結至 quote.html?view=history。
- 報價紀錄使用原有雲端報價查詢功能，保留未刪除/已刪除檢視、載入修改及依角色限制的操作權限。
- 從報價紀錄頁面可返回工作首頁。

聯絡資料驗證更新：部署時必須一併上傳 assets/validation.js；店家管理、員工管理及店家聯絡人表單會使用此共用驗證程式。請先執行 ZIP 根目錄的 add-contact-landline-validation.sql。
