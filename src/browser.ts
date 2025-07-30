import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { logger } from './logger.js';
import { getConfig } from './config.js';
import fs from 'fs';
import path from 'path';

export interface BrowserConfig {
    headless?: boolean;
    timeout?: number;
    viewport?: { width: number; height: number };
    downloadPath?: string;
}

export interface ClassificationSocietyCredentials {
    username: string;
    password: string;
    email?: string;
    emailPassword?: string;
}

export class BrowserAutomation {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    protected downloadPath: string;

    constructor(private browserConfig: BrowserConfig = {}) {
        this.downloadPath = browserConfig.downloadPath || path.join(process.cwd(), 'downloads');
        this.ensureDownloadDirectory();
    }

    private ensureDownloadDirectory(): void {
        if (!fs.existsSync(this.downloadPath)) {
            fs.mkdirSync(this.downloadPath, { recursive: true });
        }
    }

    async initialize(): Promise<void> {
        try {
            this.browser = await chromium.launch({
                headless: this.browserConfig.headless ?? false,
                timeout: this.browserConfig.timeout ?? 30000
            });

            this.context = await this.browser.newContext({
                viewport: this.browserConfig.viewport ?? { width: 1280, height: 800 },
                acceptDownloads: true
            });

            this.page = await this.context.newPage();
            
            // Set default timeout
            this.page.setDefaultTimeout(this.browserConfig.timeout ?? 30000);
            
            logger.info('Browser automation initialized successfully');
        } catch (error: any) {
            logger.error('Failed to initialize browser automation:', error);
            throw error;
        }
    }

    async cleanup(): Promise<void> {
        try {
            if (this.page) await this.page.close();
            if (this.context) await this.context.close();
            if (this.browser) await this.browser.close();
            logger.info('Browser automation cleaned up successfully');
        } catch (error: any) {
            logger.error('Error during browser cleanup:', error);
        }
    }

    getPage(): Page {
        if (!this.page) {
            throw new Error('Browser not initialized. Call initialize() first.');
        }
        return this.page;
    }

    async waitForDownload(timeout: number = 30000): Promise<string> {
        if (!this.page) throw new Error('Page not initialized');
        
        const downloadPromise = this.page.waitForEvent('download', { timeout });
        const download = await downloadPromise;
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${download.suggestedFilename()}_${timestamp}`;
        const filepath = path.join(this.downloadPath, filename);
        
        await download.saveAs(filepath);
        logger.info(`File downloaded: ${filepath}`);
        
        return filepath;
    }

    async solveCaptchaWithOpenAI(captchaImageSelector: string): Promise<string> {
        if (!this.page) throw new Error('Page not initialized');
        
        try {
            // Take screenshot of captcha
            const captchaElement = await this.page.locator(captchaImageSelector);
            const captchaScreenshot = await captchaElement.screenshot();
            
            // Use OpenAI to solve captcha (placeholder - would need actual OpenAI integration)
            logger.info('Captcha solving requested - placeholder implementation');
            return 'CAPTCHA_SOLUTION_PLACEHOLDER';
        } catch (error: any) {
            logger.error('Failed to solve captcha:', error);
            throw error;
        }
    }

    async handlePopup(action: () => Promise<void>): Promise<Page> {
        if (!this.page) throw new Error('Page not initialized');
        
        const popupPromise = this.page.waitForEvent('popup');
        await action();
        const popup = await popupPromise;
        
        logger.info('Popup window opened');
        return popup;
    }

    async waitForNetworkIdle(timeout: number = 10000): Promise<void> {
        if (!this.page) throw new Error('Page not initialized');
        
        await this.page.waitForLoadState('networkidle', { timeout });
    }

    async takeScreenshot(filename?: string): Promise<string> {
        if (!this.page) throw new Error('Page not initialized');
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const screenshotPath = path.join(this.downloadPath, filename || `screenshot_${timestamp}.png`);
        
        await this.page.screenshot({ path: screenshotPath, fullPage: true });
        logger.info(`Screenshot saved: ${screenshotPath}`);
        
        return screenshotPath;
    }
}

// Classification Society specific automation classes
export class CCSAutomation extends BrowserAutomation {
    async downloadSurveyStatus(vesselName: string, credentials: ClassificationSocietyCredentials): Promise<string> {
        const page = this.getPage();
        const downloadDir = path.join(this.downloadPath, 'CCS');
        
        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
        }

        try {
            logger.info(`Starting CCS survey status download for vessel: ${vesselName}`);
            
            // Navigate to CCS portal
            await page.goto('https://www.ccs-service.net/loginNewEn.jsp');
            await page.waitForLoadState('networkidle');
            
            // Login process
            await page.fill('input[name="username"]', credentials.username);
            await page.fill('input[name="password"]', credentials.password);
            
            // Handle captcha if present
            const captchaExists = await page.locator('img[id*="captcha"]').count() > 0;
            if (captchaExists) {
                const captchaSolution = await this.solveCaptchaWithOpenAI('img[id*="captcha"]');
                await page.fill('input[name="captcha"]', captchaSolution);
            }
            
            await page.click('input[type="submit"]');
            await this.waitForNetworkIdle();
            
            // Navigate to fleet section
            await page.click('a[href*="fleet"]');
            await this.waitForNetworkIdle();
            
            // Search for vessel
            await page.fill('input[name="vesselName"]', vesselName);
            await page.click('button[type="submit"]');
            await this.waitForNetworkIdle();
            
            // Click on vessel link
            await page.click(`a:has-text("${vesselName}")`);
            await this.waitForNetworkIdle();
            
            // Download survey status
            const downloadPromise = this.waitForDownload();
            await page.click('a[href*="survey-status"]');
            const downloadPath = await downloadPromise;
            
            logger.info(`CCS survey status downloaded successfully for ${vesselName}`);
            return downloadPath;
            
        } catch (error: any) {
            logger.error(`Failed to download CCS survey status for ${vesselName}:`, error);
            await this.takeScreenshot(`ccs_error_${vesselName.replace(/\s+/g, '_')}.png`);
            throw error;
        }
    }
}

export class NKAutomation extends BrowserAutomation {
    async downloadSurveyStatus(vesselName: string, credentials: ClassificationSocietyCredentials): Promise<string> {
        const page = this.getPage();
        const downloadDir = path.join(this.downloadPath, 'NK');
        
        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
        }

        try {
            logger.info(`Starting NK survey status download for vessel: ${vesselName}`);
            
            // Navigate to NK portal
            await page.goto('https://portal.classnk.or.jp/portal/');
            await page.waitForLoadState('networkidle');
            
            // Login process
            await page.fill('input[name="userId"]', credentials.username);
            await page.fill('input[name="password"]', credentials.password);
            
            // Handle captcha if present
            const captchaExists = await page.locator('img[alt="CAPTCHA"]').count() > 0;
            if (captchaExists) {
                const captchaSolution = await this.solveCaptchaWithOpenAI('img[alt="CAPTCHA"]');
                await page.fill('input[name="captcha"]', captchaSolution);
            }
            
            await page.click('input[value="Login"]');
            await this.waitForNetworkIdle();
            
            // Navigate to NK-SHIPS
            await page.click('a:has-text("NK-SHIPS")');
            await this.waitForNetworkIdle();
            
            // Handle popup if it opens
            const popup = await this.handlePopup(async () => {
                await page.click('a[href*="ships"]');
            });
            
            // Search for vessel in popup
            await popup.fill('input[name="vesselName"]', vesselName);
            await popup.press('input[name="vesselName"]', 'Enter');
            await popup.waitForLoadState('networkidle');
            
            // Click on vessel from search results
            await popup.click(`tr:has-text("${vesselName}") a`);
            await popup.waitForLoadState('networkidle');
            
            // Download survey status
            const downloadPromise = this.waitForDownload();
            await popup.click('a:has-text("Survey Status")');
            const downloadPath = await downloadPromise;
            
            await popup.close();
            
            logger.info(`NK survey status downloaded successfully for ${vesselName}`);
            return downloadPath;
            
        } catch (error: any) {
            logger.error(`Failed to download NK survey status for ${vesselName}:`, error);
            await this.takeScreenshot(`nk_error_${vesselName.replace(/\s+/g, '_')}.png`);
            throw error;
        }
    }
}

export class KRAutomation extends BrowserAutomation {
    async downloadSurveyStatus(vesselName: string, credentials: ClassificationSocietyCredentials): Promise<string> {
        const page = this.getPage();
        const downloadDir = path.join(this.downloadPath, 'KR');
        
        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
        }

        try {
            logger.info(`Starting KR survey status download for vessel: ${vesselName}`);
            
            // Navigate to KR e-fleet portal
            await page.goto('https://e-fleet.krs.co.kr/View/Login/CheckMember_New_V2.aspx');
            await page.waitForLoadState('networkidle');
            
            // First authentication step
            await page.fill('input[name="txtId"]', credentials.username);
            await page.fill('input[name="txtPwd"]', credentials.password);
            await page.click('input[name="btnLogin"]');
            await this.waitForNetworkIdle();
            
            // Email authentication step
            if (credentials.email && credentials.emailPassword) {
                await page.fill('input[name="email"]', credentials.email);
                await page.fill('input[name="emailPwd"]', credentials.emailPassword);
                await page.click('input[name="btnEmailLogin"]');
                await this.waitForNetworkIdle();
            }
            
            // Navigate to VESSEL section
            await page.click('a:has-text("VESSEL")');
            await this.waitForNetworkIdle();
            
            // Search for vessel and get CLASS number via API
            const response = await page.evaluate(async (vesselName: string) => {
                const response = await fetch('/View/VESSEL/DataHandler/Vessel_List.ashx', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: `vesselName=${encodeURIComponent(vesselName)}`
                });
                return response.json();
            }, vesselName);
            
            const classNumber = (response as any).data?.[0]?.CLASS_NO;
            if (!classNumber) {
                throw new Error(`Could not find CLASS number for vessel: ${vesselName}`);
            }
            
            // Download using CLASS number
            const downloadPromise = this.waitForDownload();
            await page.goto(`https://e-fleet.krs.co.kr/View/eShip/PopUp/FileDownPage2.aspx?CLASS_NO=${classNumber}`);
            const downloadPath = await downloadPromise;
            
            logger.info(`KR survey status downloaded successfully for ${vesselName}`);
            return downloadPath;
            
        } catch (error: any) {
            logger.error(`Failed to download KR survey status for ${vesselName}:`, error);
            await this.takeScreenshot(`kr_error_${vesselName.replace(/\s+/g, '_')}.png`);
            throw error;
        }
    }
}

export class DNVAutomation extends BrowserAutomation {
    async downloadSurveyStatus(vesselName: string, credentials: ClassificationSocietyCredentials): Promise<string> {
        const page = this.getPage();
        const downloadDir = path.join(this.downloadPath, 'DNV');
        
        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
        }

        try {
            logger.info(`Starting DNV survey status download for vessel: ${vesselName}`);
            
            // Navigate to DNV Veracity portal
            await page.goto('https://www.veracity.com/auth/login');
            await page.waitForLoadState('networkidle');
            
            // Login to Veracity
            await page.fill('input[name="username"]', credentials.username);
            await page.fill('input[name="password"]', credentials.password);
            await page.click('button[type="submit"]');
            await this.waitForNetworkIdle();
            
            // Navigate to My services
            await page.click('a:has-text("My services")');
            await this.waitForNetworkIdle();
            
            // Access Fleet Status application (opens in popup)
            const popup = await this.handlePopup(async () => {
                await page.click('a:has-text("Fleet Status")');
            });
            
            // Navigate within popup to maritime.dnv.com
            await popup.goto('https://maritime.dnv.com/Fleet');
            await popup.waitForLoadState('networkidle');
            
            // Accept cookies
            const cookieButton = popup.locator('button:has-text("Accept")');
            if (await cookieButton.count() > 0) {
                await cookieButton.click();
            }
            
            // Navigate to Vessel list
            await popup.click('a:has-text("Vessels")');
            await popup.waitForLoadState('networkidle');
            
            // Search for vessel
            await popup.fill('input[placeholder*="vessel"]', vesselName);
            await popup.press('input[placeholder*="vessel"]', 'Enter');
            await popup.waitForLoadState('networkidle');
            
            // Select vessel
            await popup.click(`tr:has-text("${vesselName}") a`);
            await popup.waitForLoadState('networkidle');
            
            // Verify vessel is in DNV class
            const statusText = await popup.textContent('.vessel-status');
            if (!statusText?.includes('In DNV Class In Operation')) {
                throw new Error(`Vessel ${vesselName} is not in DNV Class In Operation`);
            }
            
            // Open menu and download
            await popup.click('button[aria-label="Menu"]');
            await popup.click('a:has-text("Download class status")');
            
            // Select "With Memorandum to Owner"
            await popup.check('input[value="withMemorandum"]');
            
            const downloadPromise = this.waitForDownload();
            await popup.click('button:has-text("Download PDF")');
            const downloadPath = await downloadPromise;
            
            await popup.close();
            
            logger.info(`DNV survey status downloaded successfully for ${vesselName}`);
            return downloadPath;
            
        } catch (error: any) {
            logger.error(`Failed to download DNV survey status for ${vesselName}:`, error);
            await this.takeScreenshot(`dnv_error_${vesselName.replace(/\s+/g, '_')}.png`);
            throw error;
        }
    }
}

export class LRAutomation extends BrowserAutomation {
    async downloadSurveyStatus(vesselName: string, credentials: ClassificationSocietyCredentials): Promise<string> {
        const page = this.getPage();
        const downloadDir = path.join(this.downloadPath, 'LR');
        
        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
        }

        try {
            logger.info(`Starting LR survey status download for vessel: ${vesselName}`);
            
            // Navigate to LR client portal
            await page.goto('https://www.lr.org/en/client-support/sign-in-client-portal/');
            await page.waitForLoadState('networkidle');
            
            // Accept cookies
            const cookieButton = page.locator('button:has-text("Accept")');
            if (await cookieButton.count() > 0) {
                await cookieButton.click();
            }
            
            // Click Login to open popup
            const loginPopup = await this.handlePopup(async () => {
                await page.click('a:has-text("Login")');
            });
            
            // Login in popup
            await loginPopup.fill('input[name="email"]', credentials.email || '');
            await loginPopup.fill('input[name="password"]', credentials.password);
            await loginPopup.click('button[type="submit"]');
            await loginPopup.waitForLoadState('networkidle');
            
            // Navigate to Fleet section
            await loginPopup.click('a:has-text("Fleet")');
            await loginPopup.waitForLoadState('networkidle');
            
            // Access LR Class Direct (opens new popup)
            const classDirectPopup = await this.handlePopup(async () => {
                await loginPopup.click('a:has-text("LR Class Direct")');
            });
            
            // Search for vessel
            await classDirectPopup.fill('input[placeholder*="vessel"]', vesselName);
            await classDirectPopup.press('input[placeholder*="vessel"]', 'Enter');
            await classDirectPopup.waitForLoadState('networkidle');
            
            // Select vessel from results
            await classDirectPopup.click(`tr:has-text("${vesselName}") a`);
            await classDirectPopup.waitForLoadState('networkidle');
            
            // Access Survey Status Report
            await classDirectPopup.click('a:has-text("Survey Status Report")');
            await classDirectPopup.waitForLoadState('networkidle');
            
            // Add all reports
            await classDirectPopup.click('button:has-text("Add all")');
            
            // Download PDF
            const downloadPromise = this.waitForDownload();
            await classDirectPopup.click('button:has-text("Download PDF")');
            const downloadPath = await downloadPromise;
            
            await classDirectPopup.close();
            await loginPopup.close();
            
            logger.info(`LR survey status downloaded successfully for ${vesselName}`);
            return downloadPath;
            
        } catch (error: any) {
            logger.error(`Failed to download LR survey status for ${vesselName}:`, error);
            await this.takeScreenshot(`lr_error_${vesselName.replace(/\s+/g, '_')}.png`);
            throw error;
        }
    }
}

export class BVAutomation extends BrowserAutomation {
    async downloadSurveyStatus(vesselName: string, credentials: ClassificationSocietyCredentials): Promise<string> {
        const page = this.getPage();
        const downloadDir = path.join(this.downloadPath, 'BV');
        
        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
        }

        try {
            logger.info(`Starting BV survey status download for vessel: ${vesselName}`);
            
            // Navigate to BV Move platform
            await page.goto('https://move.bureauveritas.com/#/cms');
            await page.waitForLoadState('networkidle');
            
            // Click Connect Now
            await page.click('button:has-text("Connect Now")');
            await page.waitForLoadState('networkidle');
            
            // Login
            await page.fill('input[name="username"]', credentials.username);
            await page.fill('input[name="password"]', credentials.password);
            await page.click('button:has-text("Sign in")');
            await this.waitForNetworkIdle();
            
            // Navigate to FLEET IN SERVICE
            await page.click('a:has-text("FLEET IN SERVICE")');
            await page.waitForLoadState('networkidle');
            
            // Search and select vessel by exact name match
            const vesselElement = page.locator(`text="${vesselName}"`);
            await vesselElement.click();
            await page.waitForLoadState('networkidle');
            
            // Download Ship Status PDF
            const downloadPromise = this.waitForDownload();
            await page.click('button:has-text("Download Ship Status PDF")');
            
            // Confirm download
            await page.click('button:has-text("Download PDF")');
            const downloadPath = await downloadPromise;
            
            logger.info(`BV survey status downloaded successfully for ${vesselName}`);
            return downloadPath;
            
        } catch (error: any) {
            logger.error(`Failed to download BV survey status for ${vesselName}:`, error);
            await this.takeScreenshot(`bv_error_${vesselName.replace(/\s+/g, '_')}.png`);
            throw error;
        }
    }
}

export class ABSAutomation extends BrowserAutomation {
    async downloadSurveyStatus(vesselName: string, credentials: ClassificationSocietyCredentials): Promise<string> {
        const page = this.getPage();
        const downloadDir = path.join(this.downloadPath, 'ABS');
        
        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
        }

        try {
            logger.info(`Starting ABS survey status download for vessel: ${vesselName}`);
            
            // Navigate to ABS Eagle website
            await page.goto('https://ww2.eagle.org/en.html');
            await page.waitForLoadState('networkidle');
            
            // Click Login
            await page.click('a:has-text("Login")');
            await page.waitForLoadState('networkidle');
            
            // Login
            await page.fill('input[name="username"]', credentials.username);
            await page.fill('input[name="password"]', credentials.password);
            await page.click('button[type="submit"]');
            
            // Wait longer for ABS login and handle potential popups
            await page.waitForTimeout(40000);
            
            // Handle popup if present
            const popupExists = await page.locator('div[role="dialog"]').count() > 0;
            if (popupExists) {
                await page.click('button[aria-label="Close"]');
                await page.waitForTimeout(20000);
            }
            
            // Navigate to portal dashboard
            await page.goto('https://www.eagle.org/portal/#/portal/dashboard');
            await page.waitForLoadState('networkidle');
            
            // Navigate to Fleet -> Vessels
            await page.click('a:has-text("Fleet")');
            await page.waitForLoadState('networkidle');
            
            await page.click('a:has-text("Vessels")');
            await page.waitForLoadState('networkidle');
            
            // Clear all filters
            const clearAllButton = page.locator('button:has-text("Clear All")');
            if (await clearAllButton.count() > 0) {
                await clearAllButton.click();
            }
            
            // Search for vessel
            await page.fill('input[placeholder*="vessel"]', vesselName);
            await page.press('input[placeholder*="vessel"]', 'Enter');
            await page.waitForLoadState('networkidle');
            
            // Select vessel
            await page.click(`tr:has-text("${vesselName}") a`);
            await page.waitForLoadState('networkidle');
            
            // Click Vessel Status download
            await page.click('button:has-text("Vessel Status")');
            
            // Configure report options
            await page.check('input[value="withAsset"]');
            await page.check('input[value="withCompartments"]');
            
            // Generate and download
            const downloadPromise = this.waitForDownload();
            await page.click('button:has-text("Generate Report")');
            await page.click('button:has-text("Download")');
            const downloadPath = await downloadPromise;
            
            logger.info(`ABS survey status downloaded successfully for ${vesselName}`);
            return downloadPath;
            
        } catch (error: any) {
            logger.error(`Failed to download ABS survey status for ${vesselName}:`, error);
            await this.takeScreenshot(`abs_error_${vesselName.replace(/\s+/g, '_')}.png`);
            throw error;
        }
    }
} 
