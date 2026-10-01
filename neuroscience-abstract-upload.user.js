// ==UserScript==
// @name         Neuroscience Abstract Upload + Live URL Copy
// @namespace    https://neuroscience.episirus.org/
// @version      1.0.0
// @description  Bulk PDF upload helper for neuroscience.episirus.org/abstract-submission with automatic live URL detection and clipboard copy.
// @match        https://neuroscience.episirus.org/abstract-submission
// @match        https://neuroscience.episirus.org/abstract-submission/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  if (window.__ns_abstract_uploader_installed) return;
  window.__ns_abstract_uploader_installed = true;

  const PAGE_URL = 'https://neuroscience.episirus.org/abstract-submission';

  function htmlToElement(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html.trim();
    return temp.firstChild;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function isPdfUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url, window.location.href);
      return /\.pdf(?:[?#]|$)/i.test(u.href) || /\/pdf/i.test(u.pathname);
    } catch (e) {
      return /\.pdf(?:[?#]|$)/i.test(String(url));
    }
  }

  function normalizeUrl(url) {
    try {
      return new URL(url, window.location.href).href;
    } catch (e) {
      return url;
    }
  }

  function extractPdfUrlsFromText(text) {
    const extracted = new Set();
    if (!text) return [];

    const patterns = [
      /(https?:\/\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]+)?)/gi,
      /(\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]+)?)/gi,
      /(\/sites\/default\/files\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]+)?)/gi,
      /(\/wp-content\/uploads\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]+)?)/gi,
      /(\/uploads\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]+)?)/gi,
    ];

    patterns.forEach((pattern) => {
      const matches = text.match(pattern) || [];
      matches.forEach((match) => {
        const fixed = match.replace(/&amp;/g, '&');
        if (isPdfUrl(fixed)) {
          extracted.add(normalizeUrl(fixed));
        }
      });
    });

    try {
      const parsed = JSON.parse(text);
      const walk = (value) => {
        if (!value) return;
        if (typeof value === 'string') {
          if (isPdfUrl(value)) extracted.add(normalizeUrl(value));
          return;
        }
        if (Array.isArray(value)) value.forEach(walk);
        else if (typeof value === 'object') Object.values(value).forEach(walk);
      };
      walk(parsed);
    } catch (e) {
      // ignore parse errors
    }

    return Array.from(extracted);
  }

  function collectUrlsFromDom() {
    const urls = new Set();

    const nodes = document.querySelectorAll('a, button, div, span, p, li, td, source, img, input, script, link');
    nodes.forEach((node) => {
      const candidates = [
        node.href,
        node.getAttribute('href'),
        node.getAttribute('src'),
        node.getAttribute('data-url'),
        node.getAttribute('data-href'),
        node.textContent,
        node.value,
      ];

      candidates.forEach((candidate) => {
        if (!candidate) return;
        const matches = extractPdfUrlsFromText(candidate);
        matches.forEach((url) => urls.add(url));
      });
    });

    const allText = document.body ? document.body.innerText || document.body.textContent : '';
    extractPdfUrlsFromText(allText).forEach((url) => urls.add(url));

    return Array.from(urls);
  }

  function chooseBestUrl(fileName, urls) {
    const lowerFileName = (fileName || '').toLowerCase();
    const encoded = encodeURIComponent(fileName || '').toLowerCase();

    if (!urls || !urls.length) return null;

    const candidates = [...urls];

    const preferredPatterns = [
      '/wp-content/uploads/',
      '/sites/default/files/',
      '/uploads/',
      '/files/',
      '/wp-content/'
    ];

    for (const pattern of preferredPatterns) {
      const match = candidates.find((url) => url.toLowerCase().includes(pattern));
      if (match) return match;
    }

    const exactMatch = candidates.find((url) => {
      const decoded = decodeURIComponent(url).toLowerCase();
      return decoded.includes(lowerFileName) || decoded.includes(encoded);
    });
    if (exactMatch) return exactMatch;

    return candidates[0];
  }

  function copyText(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text);
      return true;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
      return true;
    }

    const helper = document.createElement('textarea');
    helper.value = text;
    document.body.appendChild(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
    return true;
  }

  function buildPanel() {
    const panel = htmlToElement(`
      <div id="ns-abstract-uploader-panel" style="position:fixed; right:16px; bottom:16px; width:440px; max-height:85vh; overflow:auto; z-index:2147483647; background:#ffffff; color:#111827; border:2px solid #2563eb; border-radius:12px; box-shadow:0 18px 50px rgba(0,0,0,.18); font-family:Arial, Helvetica, sans-serif; font-size:13px; line-height:1.4;">
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-bottom:1px solid #e5e7eb; background:#f8fafc;">
          <strong style="font-size:14px;">Neuroscience PDF Uploader</strong>
          <button id="ns-close-panel" type="button" style="background:#dc2626; color:#fff; border:none; border-radius:6px; padding:5px 8px; cursor:pointer; font-weight:700;">✕</button>
        </div>

        <div style="padding:12px;">
          <div style="margin-bottom:10px;">
            <input id="ns-file-input" type="file" multiple accept=".pdf,application/pdf" style="width:100%; padding:8px; border:1px solid #d1d5db; border-radius:8px; background:#fff;">
          </div>

          <div style="display:flex; gap:8px; margin-bottom:10px;">
            <button id="ns-upload-btn" type="button" style="flex:1; background:#2563eb; color:#fff; border:none; border-radius:8px; padding:10px; cursor:pointer; font-weight:700;">Upload Selected</button>
            <button id="ns-copy-all-btn" type="button" style="flex:1; background:#15803d; color:#fff; border:none; border-radius:8px; padding:10px; cursor:pointer; font-weight:700;">Copy All URLs</button>
          </div>

          <div style="margin-bottom:10px; padding:8px 10px; border-radius:8px; background:#fef3c7; color:#78350f; font-weight:600;" id="ns-status">Ready — select PDF files</div>

          <div id="ns-results" style="max-height:320px; overflow:auto; border-top:1px solid #e5e7eb; padding-top:8px;"></div>
        </div>
      </div>
    `);

    document.body.appendChild(panel);

    const closeBtn = document.getElementById('ns-close-panel');
    if (closeBtn) closeBtn.addEventListener('click', () => panel.remove());

    return {
      panel,
      fileInput: document.getElementById('ns-file-input'),
      uploadBtn: document.getElementById('ns-upload-btn'),
      copyAllBtn: document.getElementById('ns-copy-all-btn'),
      status: document.getElementById('ns-status'),
      results: document.getElementById('ns-results'),
    };
  }

  function setStatus(msg, color = '#78350f') {
    const ui = window.__ns_uploader_ui;
    if (!ui || !ui.status) return;
    ui.status.textContent = msg;
    ui.status.style.color = color;
  }

  function renderRows(rows) {
    const ui = window.__ns_uploader_ui;
    if (!ui || !ui.results) return;
    ui.results.innerHTML = '';

    if (!rows || !rows.length) {
      ui.results.innerHTML = '<div style="color:#6b7280;">No files processed yet.</div>';
      return;
    }

    rows.forEach((row, index) => {
      const item = document.createElement('div');
      item.style.borderTop = '1px solid #e5e7eb';
      item.style.padding = '10px 0';

      const title = document.createElement('div');
      title.style.fontWeight = '700';
      title.style.marginBottom = '4px';
      title.textContent = `${index + 1}. ${row.fileName}`;
      item.appendChild(title);

      const meta = document.createElement('div');
      meta.style.marginBottom = '6px';
      meta.style.color = row.url ? '#15803d' : '#374151';
      meta.textContent = row.status || 'Queued';
      item.appendChild(meta);

      if (row.url) {
        const urlLink = document.createElement('a');
        urlLink.href = row.url;
        urlLink.target = '_blank';
        urlLink.rel = 'noopener noreferrer';
        urlLink.textContent = row.url;
        urlLink.style.display = 'block';
        urlLink.style.wordBreak = 'break-all';
        urlLink.style.marginBottom = '6px';
        item.appendChild(urlLink);

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.textContent = 'Copy URL';
        copyBtn.style.background = '#0f172a';
        copyBtn.style.color = '#fff';
        copyBtn.style.border = 'none';
        copyBtn.style.borderRadius = '6px';
        copyBtn.style.padding = '6px 10px';
        copyBtn.style.cursor = 'pointer';
        copyBtn.addEventListener('click', () => {
          copyText(row.url);
          setStatus('URL copied to clipboard', '#15803d');
          setTimeout(() => setStatus('Ready — select PDF files', '#78350f'), 1200);
        });
        item.appendChild(copyBtn);
      }

      ui.results.appendChild(item);
    });
  }

  function setFilesToInput(input, files) {
    if (!input) return;

    const dataTransfer = new DataTransfer();
    files.forEach((file) => dataTransfer.items.add(file));

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: dataTransfer.files,
      writable: false
    });

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findFileInputs() {
    const selectors = [
      'input[type="file"]',
      'input[name*="file"]',
      'input[name*="upload"]',
      '[type="file"]',
      '.file-upload',
      '.upload-input',
      '.dz-hidden-input'
    ];

    const found = [];
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        if (el && el.tagName === 'INPUT') found.push(el);
      });
    });

    return [...new Set(found)];
  }

  function triggerSubmitButtons() {
    const selectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button',
      '[role="button"]'
    ];

    const candidates = [];
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        if (!el || !(el instanceof HTMLElement)) return;
        const text = (el.textContent || '').toLowerCase();
        const visible = getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
        if (visible && (text.includes('submit') || text.includes('upload') || text.includes('save') || text.includes('send'))) {
          candidates.push(el);
        }
      });
    });

    for (const el of candidates) {
      try {
        el.click();
        return true;
      } catch (e) {
        // ignore
      }
    }

    return false;
  }

  async function waitForPdfUrls(maxMs = 40000) {
    const start = Date.now();

    while (Date.now() - start < maxMs) {
      const urls = collectUrlsFromDom();
      if (urls.length) return urls;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }

    return collectUrlsFromDom();
  }

  async function uploadFiles(files) {
    const fileInputs = findFileInputs();
    if (!fileInputs.length) {
      throw new Error('No file input element found on this page. The upload form may be hidden or custom-built.');
    }

    const rows = files.map((file) => ({
      fileName: file.name,
      file,
      status: 'Queued',
      url: null
    }));

    renderRows(rows);

    const primaryInput = fileInputs.find((input) => input.multiple) || fileInputs[0];
    if (!primaryInput) {
      throw new Error('No upload field could be used.');
    }

    try {
      if (primaryInput.multiple) {
        setFilesToInput(primaryInput, files);
        const submitted = triggerSubmitButtons();
        if (!submitted) {
          rows.forEach((row) => {
            row.status = 'Submit button not found';
          });
          renderRows(rows);
          return rows;
        }

        const urls = await waitForPdfUrls();
        rows.forEach((row) => {
          const chosen = chooseBestUrl(row.fileName, urls);
          row.url = chosen;
          row.status = chosen ? 'Success' : 'No public URL detected';
        });

        renderRows(rows);
        return rows;
      }

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const row = rows[i];
        row.status = 'Uploading...';
        renderRows(rows);

        setFilesToInput(primaryInput, [file]);
        const submitted = triggerSubmitButtons();
        if (!submitted) {
          row.status = 'Submit button not found';
          renderRows(rows);
          continue;
        }

        const urls = await waitForPdfUrls();
        const chosen = chooseBestUrl(file.name, urls);
        row.url = chosen;
        row.status = chosen ? 'Success' : 'No public URL detected';
        renderRows(rows);
      }

      return rows;
    } catch (error) {
      rows.forEach((row) => {
        row.status = 'Error';
      });
      renderRows(rows);
      throw error;
    }
  }

  function copyAllUrls(rows) {
    const urls = [...new Set(rows.filter((row) => row.url).map((row) => row.url))];
    if (!urls.length) {
      setStatus('No URL to copy yet', '#b91c1c');
      setTimeout(() => setStatus('Ready — select PDF files', '#78350f'), 1500);
      return;
    }

    copyText(urls.join('\n'));
    setStatus(`Copied ${urls.length} file URL(s)`, '#15803d');
    setTimeout(() => setStatus('Ready — select PDF files', '#78350f'), 1500);
  }

  function installUI() {
    const ui = buildPanel();
    window.__ns_uploader_ui = ui;

    ui.fileInput.addEventListener('change', () => {
      const files = Array.from(ui.fileInput.files || []);
      if (files.length) {
        setStatus(`Selected ${files.length} PDF file(s)`, '#111827');
      }
    });

    ui.uploadBtn.addEventListener('click', async () => {
      const files = Array.from(ui.fileInput.files || []).filter((file) => {
        return /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
      });

      if (!files.length) {
        setStatus('Please choose PDF files first', '#b91c1c');
        return;
      }

      setStatus('Uploading and collecting live URLs…', '#111827');

      try {
        const rows = await uploadFiles(files);
        const urls = rows.filter((row) => row.url).map((row) => row.url);
        if (urls.length) {
          setStatus(`Done — ${urls.length} file URL(s) found`, '#15803d');
          window.__ns_final_urls = urls;
        } else {
          setStatus('Upload complete, but no public PDF URL was detected', '#b91c1c');
        }
      } catch (error) {
        console.error(error);
        setStatus('Upload failed — check the form and page state', '#b91c1c');
      }
    });

    ui.copyAllBtn.addEventListener('click', () => {
      const rows = window.__ns_last_rows || [];
      if (rows.length) {
        copyAllUrls(rows);
      } else {
        setStatus('No uploaded rows yet', '#b91c1c');
      }
    });

    const observer = new MutationObserver(() => {
      const urls = collectUrlsFromDom();
      if (urls.length && window.__ns_last_rows && window.__ns_last_rows.length) {
        window.__ns_last_rows.forEach((row) => {
          if (!row.url) {
            const best = chooseBestUrl(row.fileName, urls);
            if (best) {
              row.url = best;
              row.status = 'Success';
            }
          }
        });
        renderRows(window.__ns_last_rows);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    window.__ns_upload_observer = observer;
  }

  const currentUrl = window.location.href;
  if (currentUrl.includes('/abstract-submission')) {
    installUI();
  }

  window.__ns_uploader_version = '1.0.0';
})();
