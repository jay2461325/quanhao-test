

const corsHeaders = {

  "Access-Control-Allow-Origin": "https\://quan-hao-test.jay2461325.workers.dev",

  "Access-Control-Allow-Methods": "POST, OPTIONS",

  "Access-Control-Allow-Headers": "Content-Type, Authorization",

};

function json(data, status = 200) {

  return new Response(JSON.stringify(data), {

    status,

    headers: {

      ...corsHeaders,

      "Content-Type": "application/json",

    },

  });

}

function getHeaders(key) {

  return {

    apikey: key,

    Authorization: `Bearer ${key}`,

    "Content-Type": "application/json",

  };

}


// 全系統聯絡資料驗證：台灣 Email、手機及市話
function validEmail(value) {
  const v = String(value || "").trim().toLowerCase();
  return v.length <= 180 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(v);
}
// 統一手機格式：移除空格、連字號等非數字字元，但不截斷位數；資料庫統一儲存 10 碼純數字
function normalizeTaiwanMobile(value) {
  return String(value ?? "").replace(/\D/g, "");
}
function validTaiwanMobile(value) {
  return /^09\d{8}$/.test(normalizeTaiwanMobile(value));
}
const TAIWAN_LANDLINE_LENGTHS={"02":[8],"03":[7],"037":[6],"04":[7,8],"049":[7],"05":[7],"06":[7],"07":[7],"08":[7],"0823":[5],"0826":[5],"0836":[5],"089":[6]};
const TAIWAN_AREA_CODES=Object.keys(TAIWAN_LANDLINE_LENGTHS).sort((a,b)=>b.length-a.length);
function normalizeTaiwanLandline(value) {
  const raw=String(value||"").trim(); if(!raw)return "";
  const digits=raw.replace(/\D/g,""),code=TAIWAN_AREA_CODES.find(c=>digits.startsWith(c));
  return code?`${code}-${digits.slice(code.length)}`:raw;
}
function validTaiwanLandline(value) {
  const m=normalizeTaiwanLandline(value).match(/^(\d{2,4})-(\d+)$/);
  return !!m&&!!TAIWAN_LANDLINE_LENGTHS[m[1]]&&TAIWAN_LANDLINE_LENGTHS[m[1]].includes(m[2].length);
}
function validateContactFields({email,phone,landline,requirePhone=true,requireLandline=false}) {
  if(!validEmail(email))return "請輸入有效的 Email";
  if(requirePhone&&!validTaiwanMobile(phone))return "請輸入有效的手機號碼（09 開頭，共 10 碼）";
  if(!requirePhone&&String(phone||"").trim()&&!validTaiwanMobile(phone))return "請輸入有效的手機號碼（09 開頭，共 10 碼）";
  if(requireLandline&&!String(landline||"").trim())return "請輸入市話";
  if(String(landline||"").trim()&&!validTaiwanLandline(landline))return "請輸入有效的台灣市話（請確認區碼及號碼長度）";
  return "";
}

async function readJson(request) {

  try {

    return await request.json();

  } catch {

    return null;

  }

}

async function apiFetch(url, options = {}) {

  return fetch(url, options);

}

async function getAdmin(request, env) {

  const authHeader = request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {

    return {

      error: json({ error: "請先登入管理者帳號" }, 401),

    };

  }

  const base = env.SUPABASE_URL.replace(/\/$/, "");

  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  const headers = getHeaders(key);

  const userResponse = await apiFetch(`${base}/auth/v1/user`, {

    headers: {

      apikey: key,

      Authorization: authHeader,

    },

  });

  if (!userResponse.ok) {

    return {

      error: json({ error: "登入驗證失敗" }, 401),

    };

  }

  const user = await userResponse.json();

  const profileResponse = await apiFetch(

    `${base}/rest/v1/profiles?select=role,is_active,deleted_at&id=eq.${encodeURIComponent(user.id)}`,

    { headers }

  );

  if (!profileResponse.ok) {

    return {

      error: json({ error: "無法確認管理者權限" }, 403),

    };

  }

  const profiles = await profileResponse.json();

  const profile = profiles[0];

  if (

    !profile ||

    profile.role !== "admin" ||

    profile.is_active !== true ||

    profile.deleted_at !== null

  ) {

    return {

      error: json({ error: "只有有效的管理者可以執行此操作" }, 403),

    };

  }

  return {

    base,

    key,

    headers,

    user,

  };

}

async function getEmployee(base, headers, userId) {

  const response = await apiFetch(

    `${base}/rest/v1/profiles?select=id,display_name,role,phone,landline,is_active,must_change_password,deleted_at&id=eq.${encodeURIComponent(userId)}`,

    { headers }

  );

  if (!response.ok) {

    throw new Error("無法查詢員工資料");

  }

  const rows = await response.json();

  if (!rows.length || rows[0].role !== "employee") {

    throw new Error("找不到此員工帳號");

  }

  return rows[0];

}


// 寫入員工操作稽核紀錄；稽核失敗不回滾已完成的帳號操作，但會回報 audit_logged=false
// 員工操作稽核紀錄
// 稽核失敗不影響已完成的員工帳號操作
async function logEmployeeAudit(admin, action, employee, summary, extra = {}) {
  try {
    const { base, headers, user } = admin;

    const response = await apiFetch(`${base}/rest/v1/audit_logs`, {
      method: "POST",
      headers: {
        ...headers,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        user_id: user.id,
        action,
        table_name: "employee_accounts",
        record_id: employee.id,
        details: {
          employee_name: employee.display_name || "",
          employee_email: extra.email || "",
          summary,
          ...extra,
        },
      }),
    });

    if (!response.ok) {
      return {
        logged: false,
        error: await response.text(),
      };
    }

    return { logged: true };

  } catch (error) {
    return {
      logged: false,
      error: error.message || "稽核紀錄寫入發生錯誤",
    };
  }
}

async function createAuthUser(base, headers, email, password) {

  const response = await apiFetch(`${base}/auth/v1/admin/users`, {

    method: "POST",

    headers,

    body: JSON.stringify({

      email,

      password,

      email_confirm: true,

    }),

  });

  const result = await response.json();

  if (!response.ok) {

    throw new Error(

      result.message || result.msg || "建立登入帳號失敗"

    );

  }

  return result;

}

async function deleteAuthUser(base, headers, userId) {

  return apiFetch(

    `${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`,

    {

      method: "DELETE",

      headers,

    }

  );

}

// 原有：建立店家帳號

async function createCustomer(request, env, admin) {

  const { base, headers } = admin;

  const body = await readJson(request);

  if (!body) {

    return json({ error: "資料格式錯誤" }, 400);

  }

  const email = String(body.email || "").trim().toLowerCase();

  const password = String(body.password || "");

  const storeId = String(body.store_id || "").trim();

  if (!email || !password || !storeId) {
    return json({ error: "請提供 Email、密碼及店家資料" }, 400);
  }
  if (!validEmail(email)) return json({ error: "請輸入有效的 Email" }, 400);

  if (password.length < 8) {

    return json({ error: "密碼至少需要 8 個字元" }, 400);

  }

  const storeResponse = await apiFetch(

    `${base}/rest/v1/stores?select=id&id=eq.${encodeURIComponent(storeId)}&is_active=eq.true`,

    { headers }

  );

  if (!storeResponse.ok) {

    return json({ error: "無法確認店家資料" }, 400);

  }

  const stores = await storeResponse.json();

  if (!stores.length) {

    return json({ error: "店家不存在或已停用" }, 400);

  }

  const created = await createAuthUser(

    base,

    headers,

    email,

    password

  );

  const newUserId = created.id;

  const profileResponse = await apiFetch(

    `${base}/rest/v1/profiles`,

    {

      method: "POST",

      headers: {

        ...headers,

        Prefer: "return=minimal",

      },

      body: JSON.stringify({

        id: newUserId,

        role: "customer",

      }),

    }

  );

  if (!profileResponse.ok) {

    const details = await profileResponse.text();

    const rollback = await deleteAuthUser(

      base,

      headers,

      newUserId

    );

    return json({

      error: "設定店家帳號權限失敗",

      details,

      rollback_success: rollback.ok,

    }, 500);

  }

  const bindingResponse = await apiFetch(

    `${base}/rest/v1/customer_store_accounts`,

    {

      method: "POST",

      headers: {

        ...headers,

        Prefer: "return=minimal",

      },

      body: JSON.stringify({

        user_id: newUserId,

        store_id: storeId,

      }),

    }

  );

  if (!bindingResponse.ok) {

    const details = await bindingResponse.text();

    const rollback = await deleteAuthUser(

      base,

      headers,

      newUserId

    );

    return json({

      error: "綁定店家失敗",

      details,

      rollback_success: rollback.ok,

    }, 500);

  }

  return json({

    success: true,

    message: "店家登入帳號建立成功",

    user_id: newUserId,

  });

}

// 新增：建立員工帳號

async function createEmployee(request, admin) {

  const { base, headers } = admin;

  const body = await readJson(request);

  if (!body) {

    return json({ error: "資料格式錯誤" }, 400);

  }

  const displayName = String(body.display_name || "").trim();

  const email = String(body.email || "").trim().toLowerCase();

  const phone = normalizeTaiwanMobile(body.phone);
  const landline = normalizeTaiwanLandline(body.landline || "");
  const password = String(body.password || "");
  const contactError = validateContactFields({ email, phone, landline, requirePhone: true, requireLandline: false });
  if (!displayName || !password || contactError) {
    if (contactError) return json({ error: contactError }, 400);

    return json({

      error: "請填寫員工姓名、Email、手機號碼及初始密碼",

    }, 400);

  }

  if (password.length < 8) {

    return json({ error: "初始密碼至少需要 8 個字元" }, 400);

  }

  const created = await createAuthUser(

    base,

    headers,

    email,

    password

  );

  const newUserId = created.id;

  const profileResponse = await apiFetch(

    `${base}/rest/v1/profiles`,

    {

      method: "POST",

      headers: {

        ...headers,

        Prefer: "return=minimal",

      },

      body: JSON.stringify({

        id: newUserId,

        display_name: displayName,

        role: "employee",

        phone,
        landline: landline || null,

        is_active: true,

        must_change_password: true,

      }),

    }

  );

  if (!profileResponse.ok) {

    const details = await profileResponse.text();

    const rollback = await deleteAuthUser(

      base,

      headers,

      newUserId

    );

    return json({

      error: "建立員工資料失敗",

      details,

      rollback_success: rollback.ok,

    }, 500);

  }

  const audit = await logEmployeeAudit(admin, "employee_created",
    { id: newUserId, display_name: displayName }, "建立員工帳號", { email, phone, landline });

  return json({

    success: true,

    message: "員工帳號建立成功",

    user_id: newUserId,

    must_change_password: true,
    audit_logged: audit.logged,
    audit_error: audit.error || null,

  });

}

// 新增：編輯員工姓名、Email、手機

async function updateEmployee(request, admin) {

  const { base, headers } = admin;

  const body = await readJson(request);

  if (!body) {

    return json({ error: "資料格式錯誤" }, 400);

  }

  const userId = String(body.user_id || "").trim();

  const displayName = String(body.display_name || "").trim();

  const email = String(body.email || "").trim().toLowerCase();

  const phone = normalizeTaiwanMobile(body.phone);
  const landline = normalizeTaiwanLandline(body.landline || "");
  const contactError = validateContactFields({ email, phone, landline, requirePhone: true, requireLandline: false });
  if (!userId || !displayName || contactError) {
    return json({ error: contactError || "請填寫完整員工資料" }, 400);
  }

  const employee = await getEmployee(

    base,

    headers,

    userId

  );

  if (!employee.is_active || employee.deleted_at !== null) {

    return json({

      error: "此員工已停用或已刪除，不能直接編輯",

    }, 400);

  }

  const authResponse = await apiFetch(

    `${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`,

    {

      method: "PUT",

      headers,

      body: JSON.stringify({ email }),

    }

  );

  if (!authResponse.ok) {

    const details = await authResponse.text();

    return json({

      error: "更新員工 Email 失敗",

      details,

    }, 400);

  }

  const profileResponse = await apiFetch(

    `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&role=eq.employee`,

    {

      method: "PATCH",

      headers: {

        ...headers,

        Prefer: "return=minimal",

      },

      body: JSON.stringify({

        display_name: displayName,

        phone,
        landline: landline || null,

      }),

    }

  );

  if (!profileResponse.ok) {

    return json({

      error: "Email 已更新，但員工基本資料更新失敗，請聯絡管理者處理",

      details: await profileResponse.text(),

    }, 500);

  }

  const audit = await logEmployeeAudit(admin, "employee_updated",
    { id: userId, display_name: displayName }, "修改員工基本資料", { email, phone, landline });

  return json({

    success: true,

    message: "員工資料更新成功",
    audit_logged: audit.logged,
    audit_error: audit.error || null,

  });

}

// 新增：員工啟用及停用

async function setEmployeeStatus(request, admin) {

  const { base, headers } = admin;

  const body = await readJson(request);

  if (!body) {

    return json({ error: "資料格式錯誤" }, 400);

  }

  const userId = String(body.user_id || "").trim();

  if (!userId || typeof body.is_active !== "boolean") {

    return json({

      error: "請提供員工 ID 及啟用狀態",

    }, 400);

  }

  const employee = await getEmployee(

    base,

    headers,

    userId

  );

  if (employee.deleted_at !== null) {

    return json({

      error: "已軟刪除的員工，請先復原才能變更狀態",

    }, 400);

  }

  const response = await apiFetch(

    `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&role=eq.employee`,

    {

      method: "PATCH",

      headers: {

        ...headers,

        Prefer: "return=minimal",

      },

      body: JSON.stringify({

        is_active: body.is_active,

      }),

    }

  );

  if (!response.ok) {

    return json({

      error: "更新員工狀態失敗",

      details: await response.text(),

    }, 500);

  }

  // 員工停用時，清除該員工持有的所有報價編輯鎖*

if (body.is_active === false) {

  const lockResponse = await apiFetch(

    `${base}/rest/v1/quotation_locks?locked_by=eq.${encodeURIComponent(userId)}`,

    {

      method: "DELETE",

      headers: {

        ...headers,

        Prefer: "return=minimal",

      },

    }

  );

  if (!lockResponse.ok) {

    return json({

      error: "員工已停用，但清除報價編輯鎖失敗",

      details: await lockResponse.text(),

    }, 500);

  }

}

  const audit = await logEmployeeAudit(admin,
    body.is_active ? "employee_enabled" : "employee_disabled",
    employee, body.is_active ? "重新啟用員工帳號" : "停用員工帳號");

  return json({

    success: true,

    message: body.is_active ? "員工已啟用" : "員工已停用",
    audit_logged: audit.logged,
    audit_error: audit.error || null,

  });

}

// 員工永久刪除：預檢報價紀錄，並透過資料庫 RPC 保護歷史資料
async function hardDeleteEmployee(request, admin) {
  const { base, headers, user } = admin;
  const body = await readJson(request);
  if (!body) return json({ error: "資料格式錯誤" }, 400);

  const userId = String(body.user_id || "").trim();
  const confirmationName = String(body.confirmation_name || "").trim();
  const preflight = body.preflight === true;

  if (!userId || userId === user.id) {
    return json({ error: "無法刪除自己的管理者帳號" }, 400);
  }

  const employee = await getEmployee(base, headers, userId);
  // 用報價單的建立者、修改者及刪除者欄位計算歷史關聯。
  const quoteResponse = await apiFetch(
    `${base}/rest/v1/quotations?select=id&or=(created_by.eq.${encodeURIComponent(userId)},updated_by.eq.${encodeURIComponent(userId)},deleted_by.eq.${encodeURIComponent(userId)})`,
    { headers: { ...headers, Prefer: "count=exact" } }
  );
  if (!quoteResponse.ok) {
    return json({ error: "無法確認員工是否有歷史報價", details: await quoteResponse.text() }, 500);
  }

  const range = quoteResponse.headers.get("Content-Range") || "";
  const countMatch = range.match(/\/(\d+|\*)$/);
  let quotationCount = countMatch && countMatch[1] !== "*" ? Number(countMatch[1]) : null;
  if (quotationCount === null) {
    const countResponse = await apiFetch(
      `${base}/rest/v1/quotations?select=id&or=(created_by.eq.${encodeURIComponent(userId)},updated_by.eq.${encodeURIComponent(userId)},deleted_by.eq.${encodeURIComponent(userId)})`,
      { headers }
    );
    if (!countResponse.ok) {
      return json({ error: "無法確認員工歷史報價數量", details: await countResponse.text() }, 500);
    }
    quotationCount = (await countResponse.json()).length;
  }

  if (preflight) {
    return json({
      success: true,
      preflight: true,
      quotation_count: quotationCount,
      employee_name: employee.display_name || ""
    });
  }

  if (quotationCount > 0 && confirmationName !== employee.display_name) {
    return json({
      error: `此員工有 ${quotationCount} 筆報價關聯，請輸入完整員工姓名確認`,
      requires_name_confirmation: true,
      quotation_count: quotationCount,
      employee_name: employee.display_name || ""
    }, 409);
  }

  // RPC 在單一資料庫交易內：保留報價快照、解除 FK、保留稽核紀錄並刪除 profile。
  const prepareResponse = await apiFetch(`${base}/rest/v1/rpc/prepare_employee_hard_delete`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      p_user_id: userId,
      p_admin_id: user.id,
      p_confirmation_name: confirmationName
    })
  });

  if (!prepareResponse.ok) {
    return json({
      error: "員工刪除前的資料保護程序失敗，尚未刪除登入帳號",
      details: await prepareResponse.text()
    }, 500);
  }

  const prepared = await prepareResponse.json();

  // profile 及所有 FK 關聯處理成功後，才刪除 Supabase Auth 使用者。
  const authDelete = await deleteAuthUser(base, headers, userId);
  if (!authDelete.ok && authDelete.status !== 404) {
    return json({
      error: "歷史報價及稽核資料已安全保留，員工已停用；Supabase 登入帳號刪除失敗，請再次執行永久刪除重試",
      details: await authDelete.text(),
      retry_required: true,
      prepared
    }, 500);
  }

  // Auth 已刪除（或原本已不存在）後，再移除 profile；404/空結果視為已清除。
  const profileDelete = await apiFetch(
    `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&role=eq.employee`,
    { method: "DELETE", headers: { ...headers, Prefer: "return=minimal" } }
  );
  if (!profileDelete.ok) {
    return json({
      error: "登入帳號已刪除，但員工基本資料清除失敗；請再次執行永久刪除完成清理",
      details: await profileDelete.text(),
      retry_required: true,
      prepared
    }, 500);
  }

  const audit = await logEmployeeAudit(
    admin,
    "employee_permanently_deleted",
    employee,
    "永久刪除員工登入帳號；保留歷史報價及操作紀錄",
    {
      quotation_count: quotationCount,
      preserved_quotations: true,
      preserved_audit_logs: true,
      deleted_employee_name: employee.display_name || "",
      deleted_employee_email: prepared.employee_email || ""
    }
  );

  return json({
    success: true,
    message: "員工已永久刪除，歷史報價及操作紀錄已保留",
    quotation_count: quotationCount,
    preserved: { quotations: true, audit_logs: true },
    audit_logged: audit.logged,
    audit_error: audit.error || null,
    prepared
  });
}

async function completeInitialPasswordChange(request, env) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return json({ error: "請先登入" }, 401);
  }

  const body = await readJson(request);
  const password = String(body?.password || "");
  if (password.length < 8) {
    return json({ error: "新密碼至少需要 8 個字元" }, 400);
  }

  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = getHeaders(key);

  // 以目前登入者的 access token 驗證身分，不接受前端傳入 user_id。
  const userResponse = await apiFetch(`${base}/auth/v1/user`, {
    headers: { apikey: key, Authorization: authHeader },
  });
  if (!userResponse.ok) return json({ error: "登入驗證失敗" }, 401);
  const user = await userResponse.json();

  const profileResponse = await apiFetch(
    `${base}/rest/v1/profiles?select=role,is_active,must_change_password,deleted_at&id=eq.${encodeURIComponent(user.id)}`,
    { headers }
  );
  if (!profileResponse.ok) return json({ error: "無法讀取帳號資料" }, 500);
  const profiles = await profileResponse.json();
  const profile = profiles[0];
  if (!profile || !["employee", "customer"].includes(profile.role) || profile.is_active !== true || profile.deleted_at !== null) {
    return json({ error: "帳號不存在、已停用或已刪除，無法修改初始密碼" }, 403);
  }
  if (profile.must_change_password !== true) {
    return json({ error: "此帳號已完成首次密碼修改" }, 400);
  }

  // 店家聯絡人必須仍綁定有效店家；停用中的聯絡人不能藉由首次改密碼恢復存取。
  if (profile.role === "customer") {
    const bindingResponse = await apiFetch(
      `${base}/rest/v1/customer_store_accounts?select=store_id,is_active&user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true`,
      { headers }
    );
    if (!bindingResponse.ok) return json({ error: "無法確認店家聯絡人權限" }, 500);
    const bindings = await bindingResponse.json();
    if (!bindings.length) return json({ error: "此店家聯絡人已停用或未綁定店家" }, 403);

    const storeIds = [...new Set(bindings.map((item) => item.store_id).filter(Boolean))];
    if (!storeIds.length) return json({ error: "此帳號沒有有效的店家綁定" }, 403);
    const storeFilter = storeIds.map((id) => `"${String(id).replace(/"/g, "")}"`).join(",");
    const storeResponse = await apiFetch(
      `${base}/rest/v1/stores?select=id,is_active&id=in.(${encodeURIComponent(storeFilter)})&is_active=eq.true`,
      { headers }
    );
    if (!storeResponse.ok) return json({ error: "無法確認店家啟用狀態" }, 500);
    const activeStores = await storeResponse.json();
    if (!activeStores.length) return json({ error: "所屬店家已停用，無法完成首次密碼修改" }, 403);
  }

  const passwordResponse = await apiFetch(
    `${base}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
    { method: "PUT", headers, body: JSON.stringify({ password }) }
  );
  if (!passwordResponse.ok) {
    return json({ error: "更新密碼失敗", details: await passwordResponse.text() }, 400);
  }

  const updateResponse = await apiFetch(
    `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&role=eq.${encodeURIComponent(profile.role)}`,
    {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ must_change_password: false }),
    }
  );
  if (!updateResponse.ok) {
    return json({ error: "密碼已更新，但帳號狀態更新失敗，請聯絡管理者", details: await updateResponse.text() }, 500);
  }

  return json({ success: true, message: "首次密碼修改成功" });
}

async function listEmployees(admin) {

  const { base, headers } = admin;

  // 取得所有員工基本資料

  const profileResponse = await fetch(

    `${base}/rest/v1/profiles?select=id,display_name,role,phone,landline,is_active,must_change_password,deleted_at,deleted_by,created_at&role=eq.employee&order=created_at.desc`,

    { headers }

  );

  if (!profileResponse.ok) {

    return json({

      error: "讀取員工資料失敗",

      details: await profileResponse.text()

    }, 500);

  }

  const profiles = await profileResponse.json();

  // 從 Supabase Auth 取得員工 Email

  const users = [];

  let page = 1;

  const perPage = 100;

  while (true) {

    const authResponse = await fetch(

      `${base}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,

      { headers }

    );

    if (!authResponse.ok) {

      return json({

        error: "讀取員工 Email 失敗",

        details: await authResponse.text()

      }, 500);

    }

    const result = await authResponse.json();

    const batch = result.users || [];

    users.push(...batch);

    if (batch.length < perPage) break;

    page++;

  }

  const emailMap = new Map(

    users.map(user => [user.id, user.email || ""])

  );

  const employees = profiles.map(profile => ({

    ...profile,

    email: emailMap.get(profile.id) || ""

  }));

  return json({

    success: true,

    employees

  });

}


// 店家聯絡人管理：同一家店可有多個獨立登入帳號
async function logCustomerContactAudit(admin, action, contact, summary, extra = {}) {
  try {
    const { base, headers, user } = admin;
    const response = await apiFetch(`${base}/rest/v1/audit_logs`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: user.id,
        action,
        table_name: "customer_contacts",
        record_id: contact.id,
        details: {
          contact_name: contact.display_name || "",
          contact_email: contact.email || "",
          store_id: contact.store_id || "",
          summary,
          ...extra,
        },
      }),
    });
    if (!response.ok) return { logged: false, error: await response.text() };
    return { logged: true };
  } catch (error) {
    return { logged: false, error: error.message || "稽核紀錄寫入失敗" };
  }
}

async function getCustomerContact(base, headers, userId, storeId) {
  const [profileResponse, bindingResponse, authResponse] = await Promise.all([
    apiFetch(`${base}/rest/v1/profiles?select=id,display_name,role,phone,landline,is_active&id=eq.${encodeURIComponent(userId)}`, { headers }),
    apiFetch(`${base}/rest/v1/customer_store_accounts?select=user_id,store_id,is_active&user_id=eq.${encodeURIComponent(userId)}&store_id=eq.${encodeURIComponent(storeId)}`, { headers }),
    apiFetch(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers }),
  ]);
  if (!profileResponse.ok || !bindingResponse.ok) throw new Error("無法確認聯絡人資料");
  const profiles = await profileResponse.json();
  const bindings = await bindingResponse.json();
  if (!profiles.length || profiles[0].role !== "customer" || !bindings.length) {
    throw new Error("找不到此店家的聯絡人");
  }
  let email = "";
  if (authResponse.ok) {
    const authUser = await authResponse.json();
    email = authUser.email || "";
  }
  return { ...profiles[0], email, store_id: storeId, account_is_active: bindings[0].is_active };
}

async function listCustomerContacts(request, admin) {
  const { base, headers } = admin;
  const body = await readJson(request);
  const storeId = String(body?.store_id || "").trim();
  if (!storeId) return json({ error: "缺少店家 ID" }, 400);

  const storeResponse = await apiFetch(
    `${base}/rest/v1/stores?select=id,name&id=eq.${encodeURIComponent(storeId)}`,
    { headers }
  );
  if (!storeResponse.ok) return json({ error: "無法查詢店家資料" }, 500);
  const stores = await storeResponse.json();
  if (!stores.length) return json({ error: "找不到此店家" }, 404);

  const bindingResponse = await apiFetch(
    `${base}/rest/v1/customer_store_accounts?select=user_id,store_id,is_active&store_id=eq.${encodeURIComponent(storeId)}&order=user_id.asc`,
    { headers }
  );
  if (!bindingResponse.ok) return json({ error: "讀取聯絡人關聯失敗", details: await bindingResponse.text() }, 500);
  const bindings = await bindingResponse.json();
  if (!bindings.length) return json({ success: true, store: stores[0], contacts: [] });

  const ids = [...new Set(bindings.map(x => x.user_id))];
  const inFilter = `(${ids.map(id => encodeURIComponent(id)).join(",")})`;
  const profileResponse = await apiFetch(
    `${base}/rest/v1/profiles?select=id,display_name,role,phone,landline,is_active,created_at&id=in.${inFilter}&role=eq.customer`,
    { headers }
  );
  if (!profileResponse.ok) return json({ error: "讀取聯絡人資料失敗", details: await profileResponse.text() }, 500);
  const profiles = await profileResponse.json();

  const authResponse = await apiFetch(`${base}/auth/v1/admin/users?page=1&per_page=1000`, { headers });
  if (!authResponse.ok) return json({ error: "讀取聯絡人 Email 失敗", details: await authResponse.text() }, 500);
  const authResult = await authResponse.json();
  const emailMap = new Map((authResult.users || []).map(u => [u.id, u.email || ""]));
  const bindingMap = new Map(bindings.map(b => [b.user_id, b]));
  const contacts = profiles.map(profile => ({
    ...profile,
    email: emailMap.get(profile.id) || "",
    store_id: storeId,
    account_is_active: bindingMap.get(profile.id)?.is_active === true,
  }));
  return json({ success: true, store: stores[0], contacts });
}

async function createCustomerContact(request, admin) {
  const { base, headers } = admin;
  const body = await readJson(request);
  if (!body) return json({ error: "資料格式錯誤" }, 400);
  const storeId = String(body.store_id || "").trim();
  const displayName = String(body.display_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = normalizeTaiwanMobile(body.phone);
  const landline = normalizeTaiwanLandline(body.landline || "");
  const password = String(body.password || "");
  const contactError = validateContactFields({ email, phone, landline, requirePhone: false, requireLandline: false });
  if (!storeId || !displayName || !password || contactError) {
    return json({ error: contactError || "請填寫店家、聯絡人姓名及初始密碼" }, 400);
  }
  if (password.length < 8) return json({ error: "初始密碼至少需要 8 個字元" }, 400);

  const storeResponse = await apiFetch(
    `${base}/rest/v1/stores?select=id,name&id=eq.${encodeURIComponent(storeId)}&is_active=eq.true`,
    { headers }
  );
  if (!storeResponse.ok) return json({ error: "無法確認店家資料" }, 500);
  const stores = await storeResponse.json();
  if (!stores.length) return json({ error: "店家不存在或已停用" }, 404);

  const created = await createAuthUser(base, headers, email, password);
  const userId = created.id;
  const profileResponse = await apiFetch(`${base}/rest/v1/profiles`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ id: userId, display_name: displayName, role: "customer", phone: phone || null, landline: landline || null, is_active: true, must_change_password: true }),
  });
  if (!profileResponse.ok) {
    const details = await profileResponse.text();
    const rollback = await deleteAuthUser(base, headers, userId);
    return json({ error: "建立聯絡人基本資料失敗", details, rollback_success: rollback.ok }, 500);
  }

  const bindingResponse = await apiFetch(`${base}/rest/v1/customer_store_accounts`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: userId, store_id: storeId, is_active: true }),
  });
  if (!bindingResponse.ok) {
    const details = await bindingResponse.text();
    const rollback = await deleteAuthUser(base, headers, userId);
    return json({ error: "綁定店家失敗", details, rollback_success: rollback.ok }, 500);
  }

  const audit = await logCustomerContactAudit(
    admin, "customer_contact_created",
    { id: userId, display_name: displayName, email, store_id: storeId },
    "新增店家聯絡人", { phone, landline }
  );
  return json({ success: true, message: "聯絡人建立成功", user_id: userId, audit_logged: audit.logged, audit_error: audit.error || null });
}

async function updateCustomerContact(request, admin) {
  const { base, headers } = admin;
  const body = await readJson(request);
  if (!body) return json({ error: "資料格式錯誤" }, 400);
  const userId = String(body.user_id || "").trim();
  const storeId = String(body.store_id || "").trim();
  const displayName = String(body.display_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = normalizeTaiwanMobile(body.phone);
  const landline = normalizeTaiwanLandline(body.landline || "");
  const contactError = validateContactFields({ email, phone, landline, requirePhone: false, requireLandline: false });
  if (!userId || !storeId || !displayName || contactError) return json({ error: contactError || "請填寫完整聯絡人資料" }, 400);

  const contact = await getCustomerContact(base, headers, userId, storeId);
  if (!contact.account_is_active) return json({ error: "此聯絡人已停用，請先啟用再編輯" }, 400);
  const authResponse = await apiFetch(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT", headers, body: JSON.stringify({ email }),
  });
  if (!authResponse.ok) return json({ error: "更新聯絡人 Email 失敗", details: await authResponse.text() }, 400);
  const profileResponse = await apiFetch(
    `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&role=eq.customer`,
    { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ display_name: displayName, phone: phone || null, landline: landline || null }) }
  );
  if (!profileResponse.ok) return json({ error: "Email 已更新，但聯絡人資料更新失敗", details: await profileResponse.text() }, 500);
  const audit = await logCustomerContactAudit(admin, "customer_contact_updated", { id: userId, display_name: displayName, email, store_id: storeId }, "修改店家聯絡人", { phone, landline });
  return json({ success: true, message: "聯絡人資料更新成功", audit_logged: audit.logged, audit_error: audit.error || null });
}

async function setCustomerContactStatus(request, admin) {
  const { base, headers } = admin;
  const body = await readJson(request);
  if (!body) return json({ error: "資料格式錯誤" }, 400);
  const userId = String(body.user_id || "").trim();
  const storeId = String(body.store_id || "").trim();
  if (!userId || !storeId || typeof body.is_active !== "boolean") return json({ error: "請提供聯絡人 ID、店家 ID 及啟用狀態" }, 400);
  const contact = await getCustomerContact(base, headers, userId, storeId);
  const response = await apiFetch(
    `${base}/rest/v1/customer_store_accounts?user_id=eq.${encodeURIComponent(userId)}&store_id=eq.${encodeURIComponent(storeId)}`,
    { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ is_active: body.is_active }) }
  );
  if (!response.ok) return json({ error: "更新聯絡人狀態失敗", details: await response.text() }, 500);
  if (!body.is_active) {
    const lockResponse = await apiFetch(`${base}/rest/v1/quotation_locks?locked_by=eq.${encodeURIComponent(userId)}`, {
      method: "DELETE", headers: { ...headers, Prefer: "return=minimal" },
    });
    if (!lockResponse.ok) return json({ error: "聯絡人已停用，但清除編輯鎖失敗", details: await lockResponse.text() }, 500);
  }
  const audit = await logCustomerContactAudit(
    admin, body.is_active ? "customer_contact_enabled" : "customer_contact_disabled",
    { ...contact, id: userId }, body.is_active ? "重新啟用店家聯絡人" : "停用店家聯絡人"
  );
  return json({ success: true, message: body.is_active ? "聯絡人已啟用" : "聯絡人已停用", audit_logged: audit.logged, audit_error: audit.error || null });
}

async function hardDeleteCustomerContact(request, admin) {
  const { base, headers, user } = admin;
  const body = await readJson(request);
  if (!body) return json({ error: "資料格式錯誤" }, 400);
  const userId = String(body.user_id || "").trim();
  const storeId = String(body.store_id || "").trim();
  const confirmation = String(body.confirmation || "").trim();
  if (!userId || !storeId || confirmation !== "永久刪除") {
    return json({ error: "請提供聯絡人 ID、店家 ID，並輸入確認文字：永久刪除" }, 400);
  }
  if (userId === user.id) return json({ error: "不能刪除目前登入的管理者帳號" }, 400);

  const contact = await getCustomerContact(base, headers, userId, storeId);
  // 避免同一登入帳號若綁定多家店，刪除時意外一併移除其他店家的存取權
  const allBindingsResponse = await apiFetch(
    `${base}/rest/v1/customer_store_accounts?select=store_id&user_id=eq.${encodeURIComponent(userId)}`,
    { headers }
  );
  if (!allBindingsResponse.ok) {
    return json({ error: "無法確認聯絡人所屬店家，為避免誤刪已中止操作", details: await allBindingsResponse.text() }, 500);
  }
  const allBindings = await allBindingsResponse.json();
  if (allBindings.length !== 1 || allBindings[0].store_id !== storeId) {
    return json({ error: "此登入帳號不只綁定目前店家，為避免影響其他店家，暫不允許永久刪除" }, 409);
  }
  // 先將報價及稽核資料的使用者關聯安全解除，並停用聯絡人關聯
  const prepareResponse = await apiFetch(`${base}/rest/v1/rpc/prepare_customer_hard_delete`, {
    method: "POST",
    headers,
    body: JSON.stringify({ p_user_id: userId, p_admin_id: user.id }),
  });
  if (!prepareResponse.ok) {
    return json({ error: "刪除前的資料保護程序失敗，尚未刪除登入帳號", details: await prepareResponse.text() }, 500);
  }
  const prepared = await prepareResponse.json();

  // 上述 RPC 成功後才刪除 Auth 使用者；若失敗，帳號關聯已停用，可再次重試
  const deleteResponse = await deleteAuthUser(base, headers, userId);
  if (!deleteResponse.ok) {
    return json({
      error: "歷史資料已安全解除帳號關聯，但 Supabase 登入帳號刪除失敗；聯絡人已停用，請確認錯誤後重試",
      details: await deleteResponse.text(),
      prepared,
      retry_required: true,
    }, 500);
  }

  const audit = await logCustomerContactAudit(
    admin, "customer_contact_permanently_deleted",
    { id: userId, display_name: contact.display_name, email: contact.email, store_id: storeId },
    "永久刪除店家聯絡人並保留歷史報價",
    { prepared, deleted_contact_name: contact.display_name || "", deleted_contact_email: contact.email || "" }
  );
  return json({
    success: true,
    message: "聯絡人已永久刪除，歷史報價及稽核紀錄已保留",
    preserved: { quotations: true, audit_logs: true, store: true },
    audit_logged: audit.logged,
    audit_error: audit.error || null,
    prepared,
  });
}


async function hardDeleteStore(request, admin) {
  const { base, headers, user } = admin;
  const body = await readJson(request);
  if (!body) return json({ error: "資料格式錯誤" }, 400);
  const storeId = String(body.store_id || "").trim();
  const confirmationName = String(body.confirmation_name || "").trim();
  if (!storeId) return json({ error: "缺少店家 ID" }, 400);

  const storeResponse = await apiFetch(
    `${base}/rest/v1/stores?select=id,name&id=eq.${encodeURIComponent(storeId)}`,
    { headers }
  );
  if (!storeResponse.ok) return json({ error: "無法查詢店家資料", details: await storeResponse.text() }, 500);
  const stores = await storeResponse.json();
  if (!stores.length) return json({ error: "找不到此店家" }, 404);
  const store = stores[0];

  const quoteResponse = await apiFetch(
    `${base}/rest/v1/quotations?select=id&store_id=eq.${encodeURIComponent(storeId)}&limit=1`,
    { headers, headers: { ...headers, Prefer: "count=exact" } }
  );
  if (!quoteResponse.ok) return json({ error: "無法確認店家是否有報價單", details: await quoteResponse.text() }, 500);
  const contentRange = quoteResponse.headers.get("Content-Range") || "";
  const countMatch = contentRange.match(/\/(\d+|\*)$/);
  let quoteCount = countMatch && countMatch[1] !== "*" ? Number(countMatch[1]) : null;
  if (quoteCount === null) {
    const countResponse = await apiFetch(`${base}/rest/v1/quotations?select=id&store_id=eq.${encodeURIComponent(storeId)}`, { headers: { ...headers, Prefer: "count=exact" } });
    if (!countResponse.ok) return json({ error: "無法確認報價單數量", details: await countResponse.text() }, 500);
    const m = (countResponse.headers.get("Content-Range") || "").match(/\/(\d+|\*)$/);
    quoteCount = m && m[1] !== "*" ? Number(m[1]) : (await countResponse.json()).length;
  }
  if (quoteCount > 0 && confirmationName !== store.name) {
    return json({ error: `此店家有 ${quoteCount} 張報價單，請輸入完整店家名稱確認`, requires_name_confirmation: true, quotation_count: quoteCount, store_name: store.name }, 409);
  }
  // 前端第一次呼叫只做預檢，絕不在預檢階段刪除資料。
  if (body.preflight === true) {
    return json({ success: true, preflight: true, quotation_count: quoteCount, store_name: store.name });
  }

  const rpcResponse = await apiFetch(`${base}/rest/v1/rpc/prepare_store_hard_delete`, {
    method: "POST", headers,
    body: JSON.stringify({ p_store_id: storeId, p_admin_id: user.id, p_confirmation_name: confirmationName })
  });
  if (!rpcResponse.ok) return json({ error: "店家刪除前的資料保護程序失敗，尚未刪除店家", details: await rpcResponse.text() }, 500);
  const prepared = await rpcResponse.json();
  const failedDeletes = [];
  for (const contact of (prepared.contacts || [])) {
    if (!contact.user_id) continue;
    const del = await deleteAuthUser(base, headers, contact.user_id);
    if (!del.ok && del.status !== 404) failedDeletes.push({ user_id: contact.user_id, error: await del.text() });
  }

  const auditPayload = {
    user_id: user.id,
    action: "store_permanently_deleted",
    table_name: "stores",
    record_id: storeId,
    details: {
      store_name: store.name,
      quotation_count: quoteCount,
      deleted_contact_count: (prepared.contacts || []).length,
      preserved_quotations: true,
      prepared,
      auth_delete_failures: failedDeletes
    }
  };
  const auditResponse = await apiFetch(`${base}/rest/v1/audit_logs`, {
    method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(auditPayload)
  });
  return json({
    success: true,
    message: failedDeletes.length ? "店家資料已刪除並保留報價，但部分登入帳號刪除失敗，需處理" : "店家已刪除，歷史報價及稽核紀錄已保留",
    quotation_count: quoteCount,
    deleted_contacts: (prepared.contacts || []).length,
    auth_delete_failures: failedDeletes,
    audit_logged: auditResponse.ok,
    audit_error: auditResponse.ok ? null : await auditResponse.text(),
    prepared
  });
}


export default {

  async fetch(request, env) {

    if (request.method === "OPTIONS") {

      return new Response(null, {

        headers: corsHeaders,

      });

    }

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {

      return json({

        error: "Server configuration missing",

      }, 500);

    }

    if (request.method !== "POST") {

      return json({ error: "Not found" }, 404);

    }

    const url = new URL(request.url);

    const routes = {

      "/create-customer-account": "customer",

      "/create-employee-account": "createEmployee",

      "/update-employee-account": "updateEmployee",

      "/set-employee-status": "setEmployeeStatus",

      "/delete-employee-account": "hardDeleteEmployee",
      "/hard-delete-employee-account": "hardDeleteEmployee",

      "/list-employee-accounts": "listEmployees",

      "/complete-initial-password-change": "completeInitialPasswordChange",
      "/list-customer-contacts": "listCustomerContacts",
      "/create-customer-contact": "createCustomerContact",
      "/update-customer-contact": "updateCustomerContact",
      "/set-customer-contact-status": "setCustomerContactStatus",
      "/hard-delete-customer-contact": "hardDeleteCustomerContact",
      "/delete-store": "hardDeleteStore",

    };

    const action = routes[url.pathname];

    if (!action) {

      return json({ error: "Not found" }, 404);

    }

    try {

      // 首次修改密碼：使用員工自己的登入驗證，不要求管理者權限

 if (action === "completeInitialPasswordChange") {

  return await completeInitialPasswordChange(request, env);

}

// 其他 API 維持原本的管理者權限驗證

const admin = await getAdmin(request, env);

if (admin.error) {

  return admin.error;

}

      switch (action) {

        case "listEmployees":

          return await listEmployees(admin);

        case "customer":

          return await createCustomer(request, env, admin);

        case "createEmployee":

          return await createEmployee(request, admin);

        case "updateEmployee":

          return await updateEmployee(request, admin);

        case "setEmployeeStatus":

          return await setEmployeeStatus(request, admin);

        case "hardDeleteEmployee":
          return await hardDeleteEmployee(request, admin);

        case "completeInitialPasswordChange":

          return await completeInitialPasswordChange(request, env);

        case "listCustomerContacts":
          return await listCustomerContacts(request, admin);
        case "createCustomerContact":
          return await createCustomerContact(request, admin);
        case "updateCustomerContact":
          return await updateCustomerContact(request, admin);
        case "setCustomerContactStatus":
          return await setCustomerContactStatus(request, admin);
        case "hardDeleteCustomerContact":
          return await hardDeleteCustomerContact(request, admin);
        case "hardDeleteStore":
          return await hardDeleteStore(request, admin);
        default:

          return json({ error: "Not found" }, 404);

      }

    } catch (error) {

      return json({

        error: error.message || "伺服器發生錯誤，請稍後再試",

      }, 500);

    }

  },

};