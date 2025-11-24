# HireMe Job Tracker Chrome Extension

This extension lets you capture job postings directly from any job board and send them to the HireMe Job Tracker backend in one click.

## Features

- **Quick Scrape:** Detects company, role, and job description from the current tab.
- **Editable Fields:** Review and tweak the scraped data before saving.
- **Configurable API:** Works with any HireMe environment (local or deployed) via an options page.
- **Auto Token Detection & Refresh:** Automatically detects and updates your Supabase JWT token when logged into the HireMe app. Token is refreshed automatically every 30 seconds and when you navigate/refresh the app.
- **Secure Storage:** Persists your API base URL and optional token in Chrome storage.

## Installation

1. Build and run the HireMe backend so `POST /jobs` is available.
2. Open **chrome://extensions** in Google Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `chrome-extension/` folder.

## Configuration

1. **Right-click the extension icon** → Select **"Options"**
2. Enter your settings:
   - **API Base URL**: Your backend URL (e.g., `http://localhost:4000`) - **Required**
   - **API Token**: Your Supabase JWT token - **Optional** (auto-detected if you're logged into the HireMe app)

### How to Get Your API Token (Supabase JWT)

**Option 1: Auto-Detection & Auto-Refresh (Recommended)**
- If you're logged into the HireMe app in your browser, the extension will automatically detect and update your token
- The extension runs in the background and checks for token updates every 30 seconds
- Token is also refreshed automatically when you navigate or refresh the HireMe app
- No manual configuration needed! The token stays up-to-date automatically

**Option 2: Manual Method - From Browser Console**
1. Open your HireMe app in Chrome (e.g., `http://localhost:5173`)
2. Make sure you're logged in
3. Press **F12** to open Developer Tools
4. Go to the **Console** tab
5. Type this command and press Enter:
   ```javascript
   localStorage.getItem(Object.keys(localStorage).find(k => k.includes('supabase') && k.includes('auth')))
   ```
6. Copy the `access_token` value from the JSON response
7. Paste it into the extension options

**Option 3: From Network Tab**
1. Open your HireMe app and log in
2. Press **F12** → Go to **Network** tab
3. Make any API request (e.g., navigate to Job Tracker)
4. Click on the request → Go to **Headers** tab
5. Find the `Authorization: Bearer <token>` header
6. Copy the token value (without "Bearer ")

### Is the API Token Mandatory?

**No, it's optional!** The extension will:
- Try to auto-detect your token when you're on the HireMe app page
- Only require manual entry if auto-detection fails
- Work seamlessly if you're logged into the app

## Usage

1. Navigate to a job posting.
2. Open the extension popup.
3. Review the scraped company, role, and description (you can edit anything).
4. Click **Save to Job Tracker**. The extension calls `POST /jobs` with the current status (defaults to *Interested*).

## Notes

- The scraper uses heuristics and may not capture every field perfectly—feel free to edit before saving.
- Requests are authorized with your Supabase JWT, so make sure it's valid and the backend is running.
- The extension sends an optional `source_url` field so you can revisit the original posting later.
