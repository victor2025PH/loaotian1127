/**
 * E2E 測試認證輔助函數
 */
import { Page } from '@playwright/test';

// 默認測試帳號（與 conftest.py 中創建的測試用戶一致）
// 測試環境中的用戶使用 testpass123（見 admin-backend/tests/conftest.py）
const DEFAULT_TEST_CREDENTIALS = {
  username: 'admin@example.com',
  password: 'testpass123', // 測試環境密碼（與 conftest.py 一致）
};

/**
 * 登錄用戶
 * @param page Playwright 頁面對象
 * @param credentials 登錄憑證（可選，使用默認值）
 */
export async function loginUser(
  page: Page,
  credentials: { username: string; password: string } = DEFAULT_TEST_CREDENTIALS
) {
  // 訪問登錄頁面
  await page.goto('/login');
  
  // 等待登錄表單加載
  await page.waitForSelector('input[type="email"], input[name="username"], input[placeholder*="郵箱"], input[placeholder*="email"]', {
    timeout: 5000,
  }).catch(() => {
    // 如果找不到表單，可能已經登錄或頁面結構不同
    console.log('登錄表單未找到，可能已經登錄或頁面結構不同');
  });

  // 填寫用戶名
  const usernameInput = page.locator('input[type="email"], input[name="username"], input[placeholder*="郵箱"], input[placeholder*="email"]').first();
  if (await usernameInput.isVisible().catch(() => false)) {
    await usernameInput.fill(credentials.username);
  }

  // 填寫密碼
  const passwordInput = page.locator('input[type="password"], input[name="password"]').first();
  if (await passwordInput.isVisible().catch(() => false)) {
    await passwordInput.fill(credentials.password);
  }

  // 點擊登錄按鈕
  const loginButton = page.locator('button[type="submit"], button:has-text("登錄"), button:has-text("登入"), button:has-text("Login")').first();
  if (await loginButton.isVisible().catch(() => false)) {
    await loginButton.click();
    
    // 等待登錄完成（跳轉到首頁或儀表板）
    await page.waitForURL(/^(?!.*\/login)/, { timeout: 10000 }).catch(() => {
      console.log('登錄後未自動跳轉，繼續...');
    });
    
    // 等待頁面穩定
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
      // 網絡活動可能持續，繼續執行
    });
  }
}

/**
 * 使用 API 直接登錄（更快，不依賴 UI）
 * @param page Playwright 頁面對象
 * @param credentials 登錄憑證（可選）
 */
export async function loginViaAPI(
  page: Page,
  credentials: { username: string; password: string } = DEFAULT_TEST_CREDENTIALS
) {
  // 獲取 API 基礎 URL（從環境變量或使用默認值）
  const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL || 'http://localhost:8000';
  
  // 發送登錄請求（使用 form-urlencoded 格式）
  const formData = new URLSearchParams();
  formData.append('username', credentials.username);
  formData.append('password', credentials.password);
  
  const response = await page.request.post(`${apiBaseUrl}/api/v1/auth/login`, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    data: formData.toString(),
  });

  if (response.ok()) {
    const tokenData = await response.json();
    const token = tokenData.access_token;
    
    // 將 token 存儲到 localStorage
    await page.goto('/');
    await page.evaluate((t) => {
      localStorage.setItem('auth_token', t);
      localStorage.setItem('token', t);
    }, token);
    
    // 重新加載頁面以應用認證
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  } else {
    throw new Error(`登錄失敗: ${response.status()} ${response.statusText()}`);
  }
}

/**
 * 檢查是否已登錄
 * @param page Playwright 頁面對象
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  const currentUrl = page.url();
  
  // 如果在登錄頁面，表示未登錄
  if (currentUrl.includes('/login')) {
    return false;
  }
  
  // 檢查是否有 token 在 localStorage
  const hasToken = await page.evaluate(() => {
    return !!(localStorage.getItem('auth_token') || localStorage.getItem('token'));
  });
  
  return hasToken;
}

/**
 * 確保用戶已登錄（如果未登錄則登錄）
 * @param page Playwright 頁面對象
 */
export async function ensureLoggedIn(page: Page) {
  // 先檢查當前是否已登錄
  const loggedIn = await isLoggedIn(page);
  if (loggedIn) {
    return; // 已經登錄，無需重複登錄
  }

  // 嘗試使用 API 登錄（更快且更可靠）
  try {
    await loginViaAPI(page);
    // 驗證登錄是否成功
    const stillLoggedIn = await isLoggedIn(page);
    if (!stillLoggedIn) {
      throw new Error('API 登錄後驗證失敗');
    }
  } catch (error) {
    // 如果 API 登錄失敗，嘗試 UI 登錄
    console.log('API 登錄失敗，嘗試 UI 登錄:', error);
    try {
      await loginUser(page);
      // 驗證 UI 登錄是否成功
      const stillLoggedIn = await isLoggedIn(page);
      if (!stillLoggedIn) {
        throw new Error('UI 登錄後驗證失敗');
      }
    } catch (uiError) {
      throw new Error(`登錄失敗: API 和 UI 登錄都失敗。API錯誤: ${error}, UI錯誤: ${uiError}`);
    }
  }
}
