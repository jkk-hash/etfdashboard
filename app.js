/**
 * KRX ETF 종합 EDA 대시보드 - CORE APPLICATION
 * Naver Securities Live ETF API + Full Exploratory Data Analysis Suite
 */

(function () {
  'use strict';

  // =========================================================================
  // APP STATE
  // =========================================================================
  const state = {
    rawItems: [],
    etfs: [],
    filtered: [],
    loading: false,
    lastUpdated: null,
    sourceMode: 'snapshot', // 'live-direct' | 'live-proxy' | 'snapshot'
    autoRefreshInterval: null,

    // Screener & Table state
    currentPage: 1,
    pageSize: 50,
    sortColumn: 'totalNetAssets',
    sortDirection: 'desc',
    searchQuery: '',
    selectedBrand: 'ALL',
    selectedAsset: 'ALL',
    activeSpecialFilters: new Set(),
    watchlistOnly: false,
    watchlist: new Set(JSON.parse(localStorage.getItem('etf_watchlist') || '[]')),

    // Active EDA Views & Options
    activeTab: 'tab-overview',
    activeReturnPeriod: 'changeRate', // 'changeRate' | 'returnRate1m' | 'returnRate3m' | 'returnRate6m'
    moversMode: 'gainers', // 'gainers' | 'losers'
    selectedEtf: null,

    // Settings
    apiMode: localStorage.getItem('etf_api_mode') || 'auto',
    customProxy: localStorage.getItem('etf_custom_proxy') || '',

    // Chart instances cache
    charts: {}
  };

  // Color Constants for Charts (Fintech Dark Theme)
  const CHART_COLORS = {
    kodex: '#3b82f6',
    tiger: '#f97316',
    rise: '#eab308',
    ace: '#a855f7',
    plus: '#ec4899',
    sol: '#14b8a6',
    kiwoom: '#06b6d4',
    hanaro: '#10b981',
    oneQ: '#6366f1',
    koact: '#84cc16',
    others: '#64748b',
    up: '#ff4365',
    down: '#3b82f6',
    steady: '#94a3b8',
    cyan: '#38bdf8',
    emerald: '#10b981',
    amber: '#f59e0b'
  };

  // =========================================================================
  // INITIALIZATION
  // =========================================================================
  document.addEventListener('DOMContentLoaded', () => {
    initLucideIcons();
    initEventListeners();
    initSettingsValues();
    loadInitialData();
    setupAutoRefresh();
  });

  function initLucideIcons() {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  function initSettingsValues() {
    const radio = document.querySelector(`input[name="apiMode"][value="${state.apiMode}"]`);
    if (radio) radio.checked = true;
    const proxyInput = document.getElementById('customProxyInput');
    if (proxyInput) proxyInput.value = state.customProxy;
    updateWatchlistCount();
  }

  // =========================================================================
  // DATA INGESTION & ENRICHMENT
  // =========================================================================

  /**
   * Load data on startup:
   * 1. If window.INITIAL_ETF_DATA exists, populate immediately for zero latency.
   * 2. Then attempt real-time background sync from Naver API.
   */
  async function loadInitialData() {
    if (window.INITIAL_ETF_DATA && window.INITIAL_ETF_DATA.items && window.INITIAL_ETF_DATA.items.length > 0) {
      processAndApplyData(window.INITIAL_ETF_DATA.items, window.INITIAL_ETF_DATA.lastUpdated, 'snapshot');
    } else {
      // Try local JSON fetch
      try {
        const resp = await fetch('data/etf_data.json');
        if (resp.ok) {
          const json = await resp.json();
          processAndApplyData(json.items, json.lastUpdated, 'snapshot');
        }
      } catch (e) {
        console.warn('Initial json fetch failed, attempting live fetch...', e);
      }
    }

    // Now attempt live fetch from Naver API
    if (state.apiMode !== 'snapshot') {
      fetchLiveNaverEtfs();
    }
  }

  /**
   * Normalize and enrich every raw ETF item with EDA properties
   */
  function enrichEtfItem(item, index) {
    const cp = parseFloat(item.currentPrice) || 0;
    const inav = parseFloat(item.iNav) || 0;
    const changeRate = parseFloat(item.changeRate) || 0;
    const changePrice = parseFloat(item.changePrice) || 0;
    const tradingVolume = parseFloat(item.tradingVolume) || 0;
    const tradingValue = parseFloat(item.tradingValue) || 0; // in KRW
    const aum = parseFloat(item.totalNetAssets) || 0; // in KRW

    const r1m = (item.returnRate1m !== undefined && item.returnRate1m !== null && item.returnRate1m !== '') ? parseFloat(item.returnRate1m) : null;
    const r3m = (item.returnRate3m !== undefined && item.returnRate3m !== null && item.returnRate3m !== '') ? parseFloat(item.returnRate3m) : null;
    const r6m = (item.returnRate6m !== undefined && item.returnRate6m !== null && item.returnRate6m !== '') ? parseFloat(item.returnRate6m) : null;

    // Disparity % = ((Current Price - iNav) / iNav) * 100
    let disparity = 0;
    if (inav > 0) {
      disparity = ((cp - inav) / inav) * 100;
    }
    const absDisparity = Math.abs(disparity);

    // Disparity Level
    let disparityLevel = 'safe';
    if (absDisparity >= 2.0) disparityLevel = 'danger';
    else if (absDisparity >= 1.0) disparityLevel = 'warn';
    else if (absDisparity >= 0.5) disparityLevel = 'caution';

    // Brand identification
    const itemName = item.itemName || '';
    const prefix = itemName.split(/\s+/)[0] || '기타';
    let brand = prefix.toUpperCase();
    if (brand.includes('KOSEF')) brand = 'KIWOOM';
    if (brand.includes('WON')) brand = 'WOORI';

    // High level Asset classification
    const etfType = item.etfType || '';
    let assetClass = '기타';
    if (etfType.includes('국내주식') || (!etfType.includes('해외') && (itemName.includes('200') || itemName.includes('코스피') || itemName.includes('코스닥')))) {
      assetClass = '국내주식';
    } else if (etfType.includes('해외주식') || itemName.includes('미국') || itemName.includes('S&P') || itemName.includes('나스닥') || itemName.includes('차이나') || itemName.includes('글로벌') || itemName.includes('인도') || itemName.includes('일본')) {
      assetClass = '해외주식';
    } else if (etfType.includes('채권') || itemName.includes('국고채') || itemName.includes('채권') || itemName.includes('CD금리') || itemName.includes('KOFR') || itemName.includes('머니마켓')) {
      assetClass = '채권형';
    } else if (etfType.includes('혼합') || itemName.includes('TRF') || itemName.includes('TDF')) {
      assetClass = '혼합형';
    } else if (etfType.includes('파생') || etfType.includes('상품') || itemName.includes('원유') || itemName.includes('골드') || itemName.includes('은선물') || itemName.includes('구리')) {
      assetClass = '파생/원자재';
    }

    // Special tags
    const isLeverage = itemName.includes('레버리지') || itemName.includes('2X') || itemName.includes('인버스');
    const isActive = itemName.includes('액티브') || etfType.includes('액티브');
    const isDividend = itemName.includes('배당') || itemName.includes('월배당') || itemName.includes('고배당') || itemName.includes('커버드콜') || itemName.includes('프리미엄');
    const isHedged = itemName.includes('(H)');
    const isTR = itemName.includes('TR') || itemName.includes('토탈리턴');

    // Turnover Rate (%) = Trading Value / AUM
    const turnoverRate = aum > 0 ? (tradingValue / aum) * 100 : 0;

    return {
      id: item.itemCode,
      code: item.itemCode,
      name: itemName,
      brand,
      assetClass,
      etfType,
      currentPrice: cp,
      changePrice,
      changeRate,
      priceMovement: item.priceMovement || (changeRate > 0 ? 'rising' : changeRate < 0 ? 'falling' : 'unchanged'),
      tradingVolume,
      tradingValue, // KRW
      totalNetAssets: aum, // KRW
      aumInBillion: aum / 1e8, // 억원
      tradingValueInBillion: tradingValue / 1e8, // 억원
      returnRate1m: r1m,
      returnRate3m: r3m,
      returnRate6m: r6m,
      iNav: inav,
      disparity,
      absDisparity,
      disparityLevel,
      turnoverRate,
      isLeverage,
      isActive,
      isDividend,
      isHedged,
      isTR,
      originalIndex: index + 1
    };
  }

  function processAndApplyData(items, lastUpdated, mode) {
    state.rawItems = items;
    state.etfs = items.map((item, idx) => enrichEtfItem(item, idx));
    state.lastUpdated = lastUpdated || new Date().toLocaleString('ko-KR');
    state.sourceMode = mode;

    updateHeaderStatus();
    updateKpis();
    applyFilters();
    renderAllEdaCharts();
  }

  // =========================================================================
  // REAL-TIME NAVER API FETCHER
  // =========================================================================
  async function fetchLiveNaverEtfs() {
    if (state.loading) return;
    state.loading = true;

    const banner = document.getElementById('syncBanner');
    const progressBar = document.getElementById('syncProgressBar');
    const progressCount = document.getElementById('syncProgressCount');
    const refreshBtn = document.getElementById('btnLiveRefresh');
    const refreshIcon = document.getElementById('refreshIcon');

    if (banner) banner.classList.add('active');
    if (refreshBtn) refreshBtn.disabled = true;
    if (refreshIcon) refreshIcon.classList.add('spin-animation');

    const allItems = [];
    let page = 0;
    let totalCount = 1171;
    const pageSize = 100;
    let modeUsed = 'live-direct';

    try {
      while (true) {
        // Construct URL based on settings
        let targetUrl = `https://stock.naver.com/api/stockSecurity/etfs/v2/domestic?listingType=aumDesc&size=${pageSize}&index=${page}`;

        if (state.customProxy && state.customProxy.trim()) {
          targetUrl = `${state.customProxy.trim()}${encodeURIComponent(targetUrl)}`;
          modeUsed = 'live-proxy';
        } else if (window.location.port !== '3000' && window.location.hostname !== 'localhost' && window.location.protocol !== 'file:') {
          // In arbitrary static hosting, try direct first, or server proxy if available
          targetUrl = targetUrl;
        }

        if (progressCount) progressCount.textContent = `${page + 1} / 12 페이지 수신 중...`;
        if (progressBar) progressBar.style.width = `${Math.min(100, ((page + 1) / 12) * 100)}%`;

        let resp;
        try {
          resp = await fetch(targetUrl, {
            headers: { 'Accept': 'application/json' },
            cache: 'no-store'
          });
        } catch (fetchErr) {
          // If direct fetch fails (likely CORS on external static host), attempt local server endpoint if on localhost or prompt
          if (window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')) {
            try {
              const localProxyUrl = `/api/naver/etfs?listingType=aumDesc&size=${pageSize}&index=${page}`;
              resp = await fetch(localProxyUrl);
              modeUsed = 'live-proxy';
            } catch (e2) {
              throw fetchErr;
            }
          } else {
            throw fetchErr;
          }
        }

        if (!resp.ok) {
          throw new Error(`HTTP Error ${resp.status}`);
        }

        const data = await resp.json();
        const items = data.items || [];
        totalCount = parseInt(data.totalCount, 10) || totalCount;

        if (items.length === 0) break;
        allItems.push(...items);

        if (!data.hasNext || allItems.length >= totalCount) {
          break;
        }

        page++;
        // Small delay to be polite
        await new Promise(r => setTimeout(r, 60));
      }

      // Success!
      if (progressBar) progressBar.style.width = '100%';
      const nowStr = new Date().toLocaleString('ko-KR');
      processAndApplyData(allItems, nowStr, modeUsed);

    } catch (err) {
      console.warn('Real-time API sync encountered CORS or network error:', err);
      // Fallback gracefully to snapshot data if direct API call blocked
      if (state.rawItems.length === 0) {
        if (window.INITIAL_ETF_DATA) {
          processAndApplyData(window.INITIAL_ETF_DATA.items, window.INITIAL_ETF_DATA.lastUpdated, 'snapshot');
        } else {
          try {
            const resp = await fetch('data/etf_data.json');
            const json = await resp.json();
            processAndApplyData(json.items, json.lastUpdated, 'snapshot');
          } catch (e) {
            console.error('All data loading attempts failed', e);
          }
        }
      } else {
        updateHeaderStatus();
      }
    } finally {
      state.loading = false;
      if (banner) {
        setTimeout(() => banner.classList.remove('active'), 800);
      }
      if (refreshBtn) refreshBtn.disabled = false;
      if (refreshIcon) refreshIcon.classList.remove('spin-animation');
    }
  }

  function setupAutoRefresh() {
    const select = document.getElementById('autoRefreshSelect');
    if (!select) return;

    select.addEventListener('change', () => {
      if (state.autoRefreshInterval) {
        clearInterval(state.autoRefreshInterval);
        state.autoRefreshInterval = null;
      }
      const ms = parseInt(select.value, 10);
      if (ms > 0) {
        state.autoRefreshInterval = setInterval(() => {
          fetchLiveNaverEtfs();
        }, ms);
      }
    });

    // Start with default 3 min
    const initialMs = parseInt(select.value, 10);
    if (initialMs > 0) {
      state.autoRefreshInterval = setInterval(() => {
        fetchLiveNaverEtfs();
      }, initialMs);
    }
  }

  // =========================================================================
  // HEADER STATUS & KPI UPDATES
  // =========================================================================
  function updateHeaderStatus() {
    const badgeText = document.getElementById('syncStatusText');
    const pulseDot = document.getElementById('syncPulseDot');
    const lastUp = document.getElementById('lastUpdatedTime');

    if (lastUp) lastUp.textContent = state.lastUpdated || '-';

    if (state.sourceMode === 'live-direct') {
      if (badgeText) badgeText.textContent = `🟢 네이버 API 실시간 연결 (${state.etfs.length}개)`;
      if (pulseDot) { pulseDot.className = 'pulse-dot'; }
    } else if (state.sourceMode === 'live-proxy') {
      if (badgeText) badgeText.textContent = `🟢 프록시 실시간 수신 (${state.etfs.length}개)`;
      if (pulseDot) { pulseDot.className = 'pulse-dot'; }
    } else {
      if (badgeText) badgeText.textContent = `🔵 정적 시장 스냅샷 (${state.etfs.length}개)`;
      if (pulseDot) { pulseDot.className = 'pulse-dot warning'; }
    }
  }

  function updateKpis() {
    const etfs = state.etfs;
    if (!etfs.length) return;

    // 1. Total Count
    document.getElementById('kpiTotalCount').textContent = formatNumber(etfs.length);
    document.getElementById('kpiActiveCount').textContent = `정상 산출: ${etfs.filter(e => e.currentPrice > 0).length}개`;

    // 2. Total Market AUM
    const totalAum = etfs.reduce((sum, e) => sum + e.totalNetAssets, 0);
    document.getElementById('kpiTotalAum').textContent = (totalAum / 1e12).toFixed(2);

    const sortedAums = [...etfs].map(e => e.aumInBillion).sort((a, b) => a - b);
    const medianAum = sortedAums[Math.floor(sortedAums.length / 2)] || 0;
    document.getElementById('kpiMedianAum').textContent = `${formatNumber(Math.round(medianAum))} 억원`;

    // 3. Trading Value & Volume
    const totalValue = etfs.reduce((sum, e) => sum + e.tradingValue, 0);
    const totalVolume = etfs.reduce((sum, e) => sum + e.tradingVolume, 0);
    document.getElementById('kpiTradingValue').textContent = formatNumber(Math.round(totalValue / 1e8));
    document.getElementById('kpiTradingVolume').textContent = `${formatNumber(Math.round(totalVolume / 10000))} 만주`;

    // 4. Market Breadth
    let upCount = 0;
    let downCount = 0;
    let steadyCount = 0;
    etfs.forEach(e => {
      if (e.changeRate > 0) upCount++;
      else if (e.changeRate < 0) downCount++;
      else steadyCount++;
    });

    const total = etfs.length || 1;
    const upPct = ((upCount / total) * 100).toFixed(1);
    const downPct = ((downCount / total) * 100).toFixed(1);
    const steadyPct = ((steadyCount / total) * 100).toFixed(1);

    document.getElementById('breadthUpCount').textContent = upCount;
    document.getElementById('breadthDownCount').textContent = downCount;
    document.getElementById('breadthSteadyCount').textContent = steadyCount;
    document.getElementById('breadthUpBar').style.width = `${upPct}%`;
    document.getElementById('breadthSteadyBar').style.width = `${steadyPct}%`;
    document.getElementById('breadthDownBar').style.width = `${downPct}%`;
    document.getElementById('breadthUpRatio').textContent = `${upPct}%`;

    // 5. Disparity Risk Count (|괴리율| >= 1.0%)
    const riskEtfs = etfs.filter(e => e.absDisparity >= 1.0);
    const riskRatio = ((riskEtfs.length / total) * 100).toFixed(1);
    document.getElementById('kpiRiskCount').textContent = riskEtfs.length;
    document.getElementById('kpiRiskRatio').textContent = `${riskRatio}%`;
  }

  // =========================================================================
  // FILTERING, SORTING & SCREENER
  // =========================================================================
  function applyFilters() {
    let result = [...state.etfs];

    // Search query
    const q = state.searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.code.toLowerCase().includes(q) ||
        e.brand.toLowerCase().includes(q) ||
        e.etfType.toLowerCase().includes(q)
      );
    }

    // Brand filter
    if (state.selectedBrand !== 'ALL') {
      result = result.filter(e => e.brand === state.selectedBrand);
    }

    // Asset class filter
    if (state.selectedAsset !== 'ALL') {
      const assetMap = {
        'DOMESTIC_EQUITY': '국내주식',
        'GLOBAL_EQUITY': '해외주식',
        'BOND': '채권형',
        'MIXED': '혼합형',
        'DERIVATIVE': '파생/원자재'
      };
      const targetClass = assetMap[state.selectedAsset];
      if (targetClass) {
        result = result.filter(e => e.assetClass === targetClass);
      }
    }

    // Special Condition Chips
    if (state.activeSpecialFilters.has('up')) {
      result = result.filter(e => e.changeRate > 0);
    }
    if (state.activeSpecialFilters.has('down')) {
      result = result.filter(e => e.changeRate < 0);
    }
    if (state.activeSpecialFilters.has('risk')) {
      result = result.filter(e => e.absDisparity >= 1.0);
    }
    if (state.activeSpecialFilters.has('active')) {
      result = result.filter(e => e.isActive);
    }
    if (state.activeSpecialFilters.has('dividend')) {
      result = result.filter(e => e.isDividend);
    }
    if (state.activeSpecialFilters.has('leverage')) {
      result = result.filter(e => e.isLeverage);
    }

    // Watchlist filter
    if (state.watchlistOnly) {
      result = result.filter(e => state.watchlist.has(e.code));
    }

    // Sorting
    sortResults(result);

    state.filtered = result;
    state.currentPage = 1;
    renderTable();
  }

  function sortResults(arr) {
    const col = state.sortColumn;
    const isAsc = state.sortDirection === 'asc';

    arr.sort((a, b) => {
      let va = a[col];
      let vb = b[col];

      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;

      if (typeof va === 'string') {
        return isAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return isAsc ? va - vb : vb - va;
    });
  }

  function renderTable() {
    const tbody = document.getElementById('etfTableBody');
    if (!tbody) return;

    const totalCount = state.filtered.length;
    document.getElementById('filteredCount').textContent = formatNumber(totalCount);
    document.getElementById('totalItemsCount').textContent = formatNumber(state.etfs.length);

    const pageSize = state.pageSize;
    const totalPages = Math.ceil(totalCount / pageSize) || 1;
    state.currentPage = Math.min(state.currentPage, totalPages);

    document.getElementById('currentPageNum').textContent = state.currentPage;
    document.getElementById('totalPagesNum').textContent = totalPages;
    document.getElementById('pageIndicator').textContent = `${state.currentPage} / ${totalPages}`;

    const startIdx = (state.currentPage - 1) * pageSize;
    const pageItems = state.filtered.slice(startIdx, startIdx + pageSize);

    if (pageItems.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="16" style="text-align: center; padding: 40px; color: var(--text-muted);">
            <i data-lucide="search-x" style="width: 32px; height: 32px; margin-bottom: 8px; stroke-width: 1.5;"></i>
            <div>일치하는 ETF 종목이 없습니다. 검색어나 필터를 변경해 보세요.</div>
          </td>
        </tr>
      `;
      initLucideIcons();
      return;
    }

    const rowsHtml = pageItems.map((item, idx) => {
      const isStarred = state.watchlist.has(item.code);
      const starIconClass = isStarred ? 'starred' : '';
      const brandClass = getBrandClass(item.brand);

      // Return colors
      const changeClass = item.changeRate > 0 ? 'up' : item.changeRate < 0 ? 'down' : 'steady';
      const changeSign = item.changeRate > 0 ? '+' : '';

      // Disparity badge
      let dispBadge = '';
      if (item.absDisparity >= 2.0) {
        dispBadge = `<span class="disparity-pill danger" title="iNav 대비 괴리율 심화 (LP 유동성 리스크 주의)">⚠️ ${item.disparity > 0 ? '+' : ''}${item.disparity.toFixed(2)}%</span>`;
      } else if (item.absDisparity >= 1.0) {
        dispBadge = `<span class="disparity-pill warn">${item.disparity > 0 ? '+' : ''}${item.disparity.toFixed(2)}%</span>`;
      } else {
        dispBadge = `<span class="disparity-pill safe">${item.disparity > 0 ? '+' : ''}${item.disparity.toFixed(2)}%</span>`;
      }

      // Period returns format
      const r1mHtml = formatReturnCell(item.returnRate1m);
      const r3mHtml = formatReturnCell(item.returnRate3m);
      const r6mHtml = formatReturnCell(item.returnRate6m);

      return `
        <tr data-code="${item.code}">
          <td class="text-center" onclick="event.stopPropagation();">
            <button class="btn-icon ${starIconClass}" data-action="toggle-star" data-code="${item.code}" title="관심종목 등록/해제">
              <i data-lucide="star" style="width: 14px; height: 14px;"></i>
            </button>
          </td>
          <td class="text-center tabular" style="color: var(--text-muted); font-size: 0.78rem;">${startIdx + idx + 1}</td>
          <td class="tabular" style="font-family: monospace; font-size: 0.8rem; color: #94a3b8;">${item.code}</td>
          <td style="font-weight: 600; color: #fff;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span>${escapeHtml(item.name)}</span>
              ${item.isActive ? '<span class="badge-cat" style="color: #38bdf8; border-color: rgba(56, 189, 248, 0.3);">액티브</span>' : ''}
              ${item.isDividend ? '<span class="badge-cat" style="color: #fbbf24; border-color: rgba(251, 191, 36, 0.3);">배당</span>' : ''}
              ${item.isLeverage ? '<span class="badge-cat" style="color: #f43f5e; border-color: rgba(244, 63, 94, 0.3);">레버리지/인버스</span>' : ''}
            </div>
          </td>
          <td><span class="badge-brand ${brandClass}">${item.brand}</span></td>
          <td><span class="badge-cat">${item.assetClass}</span></td>
          <td class="text-right tabular font-weight-bold" style="color: #fff;">${formatNumber(item.currentPrice)}</td>
          <td class="text-right tabular">
            <span class="return-cell ${changeClass}">${changeSign}${item.changeRate.toFixed(2)}%</span>
          </td>
          <td class="text-right tabular" style="color: #94a3b8; font-size: 0.82rem;">${formatNumber(Math.round(item.iNav))}</td>
          <td class="text-right tabular">${dispBadge}</td>
          <td class="text-right tabular" style="color: #e2e8f0; font-weight: 600;">${formatAumWon(item.totalNetAssets)}</td>
          <td class="text-right tabular" style="color: #cbd5e1;">${formatNumber(Math.round(item.tradingValue / 1e8))}억</td>
          <td class="text-right tabular">${r1mHtml}</td>
          <td class="text-right tabular">${r3mHtml}</td>
          <td class="text-right tabular">${r6mHtml}</td>
          <td class="text-center" onclick="event.stopPropagation();">
            <a href="https://finance.naver.com/item/main.naver?code=${item.code}" target="_blank" rel="noopener noreferrer" class="btn-icon" title="네이버 증권 상세">
              <i data-lucide="external-link" style="width: 14px; height: 14px;"></i>
            </a>
          </td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rowsHtml;
    initLucideIcons();

    // Attach row click events for detail modal
    tbody.querySelectorAll('tr[data-code]').forEach(row => {
      row.addEventListener('click', () => {
        const code = row.getAttribute('data-code');
        openDetailModal(code);
      });
    });

    // Attach star button clicks
    tbody.querySelectorAll('button[data-action="toggle-star"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const code = btn.getAttribute('data-code');
        toggleWatchlist(code);
      });
    });
  }

  function formatReturnCell(val) {
    if (val === null || val === undefined) return '<span style="color: var(--text-muted);">-</span>';
    const cls = val > 0 ? 'up' : val < 0 ? 'down' : 'steady';
    const sign = val > 0 ? '+' : '';
    return `<span class="return-cell ${cls}">${sign}${val.toFixed(2)}%</span>`;
  }

  function getBrandClass(brand) {
    const b = (brand || '').toLowerCase();
    if (b.includes('kodex')) return 'kodex';
    if (b.includes('tiger')) return 'tiger';
    if (b.includes('rise')) return 'rise';
    if (b.includes('ace')) return 'ace';
    if (b.includes('plus')) return 'plus';
    if (b.includes('sol')) return 'sol';
    return 'default';
  }

  // =========================================================================
  // CHART RENDERING (Chart.js Integrations)
  // =========================================================================

  function renderAllEdaCharts() {
    renderOverviewCharts();
    renderIssuersCharts();
    renderCategoryCharts();
    renderReturnsAndMomentumCharts();
    renderLiquidityChart();
    renderDisparityCharts();
  }

  /**
   * 1. Overview Tab Charts
   */
  function renderOverviewCharts() {
    const etfs = state.etfs;
    if (!etfs.length) return;

    // Brand AUM Donut Chart
    const brandMap = {};
    etfs.forEach(e => {
      brandMap[e.brand] = (brandMap[e.brand] || 0) + e.totalNetAssets;
    });

    const sortedBrands = Object.entries(brandMap).sort((a, b) => b[1] - a[1]);
    const top7 = sortedBrands.slice(0, 7);
    const othersAum = sortedBrands.slice(7).reduce((acc, curr) => acc + curr[1], 0);

    const labels = [...top7.map(b => b[0]), '기타 운용사'];
    const dataValues = [...top7.map(b => (b[1] / 1e12).toFixed(2)), (othersAum / 1e12).toFixed(2)];
    const bgColors = [
      CHART_COLORS.kodex,
      CHART_COLORS.tiger,
      CHART_COLORS.rise,
      CHART_COLORS.ace,
      CHART_COLORS.plus,
      CHART_COLORS.sol,
      CHART_COLORS.kiwoom,
      CHART_COLORS.others
    ];

    if (sortedBrands.length > 0) {
      const top1 = sortedBrands[0];
      const top1Pct = ((top1[1] / etfs.reduce((s, e) => s + e.totalNetAssets, 0)) * 100).toFixed(1);
      document.getElementById('topBrandBadge').textContent = `1위: ${top1[0]} (${top1Pct}%)`;
    }

    createOrUpdateChart('chartBrandAum', {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: dataValues,
          backgroundColor: bgColors,
          borderColor: '#0f172a',
          borderWidth: 2,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#94a3b8', font: { size: 11, family: 'Pretendard' } }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${ctx.raw} 조원`
            }
          }
        },
        cutout: '68%'
      }
    });

    // Asset Class Bar Chart
    const assetAum = {};
    const assetCount = {};
    etfs.forEach(e => {
      assetAum[e.assetClass] = (assetAum[e.assetClass] || 0) + e.totalNetAssets;
      assetCount[e.assetClass] = (assetCount[e.assetClass] || 0) + 1;
    });

    const assetLabels = Object.keys(assetAum).sort((a, b) => assetAum[b] - assetAum[a]);
    const assetAumValues = assetLabels.map(l => (assetAum[l] / 1e12).toFixed(2));
    const assetCountValues = assetLabels.map(l => assetCount[l]);

    createOrUpdateChart('chartAssetClass', {
      type: 'bar',
      data: {
        labels: assetLabels,
        datasets: [
          {
            label: 'AUM (조원)',
            data: assetAumValues,
            backgroundColor: 'rgba(56, 189, 248, 0.75)',
            borderColor: '#38bdf8',
            borderWidth: 1,
            borderRadius: 6,
            yAxisID: 'y'
          },
          {
            label: '상장 종목 수',
            data: assetCountValues,
            backgroundColor: 'rgba(168, 85, 247, 0.6)',
            borderColor: '#c084fc',
            borderWidth: 1,
            borderRadius: 6,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
          y: {
            type: 'linear',
            position: 'left',
            ticks: { color: '#38bdf8' },
            grid: { color: 'rgba(255,255,255,0.05)' },
            title: { display: true, text: '순자산 (조원)', color: '#38bdf8' }
          },
          y1: {
            type: 'linear',
            position: 'right',
            ticks: { color: '#c084fc' },
            grid: { drawOnChartArea: false },
            title: { display: true, text: '종목 수 (개)', color: '#c084fc' }
          }
        },
        plugins: {
          legend: { labels: { color: '#94a3b8' } }
        }
      }
    });

    // Return Distribution Histogram
    updateReturnDistributionChart();

    // Quick Movers List
    updateQuickMoversList();
  }

  function updateReturnDistributionChart() {
    const etfs = state.etfs;
    if (!etfs.length) return;

    const periodKey = state.activeReturnPeriod;
    const values = etfs
      .map(e => e[periodKey])
      .filter(v => v !== null && !isNaN(v));

    // Histogram Bins
    const bins = [
      { label: '< -10%', min: -Infinity, max: -10, count: 0 },
      { label: '-10 ~ -5%', min: -10, max: -5, count: 0 },
      { label: '-5 ~ -2%', min: -5, max: -2, count: 0 },
      { label: '-2 ~ 0%', min: -2, max: 0, count: 0 },
      { label: '0 ~ 2%', min: 0, max: 2, count: 0 },
      { label: '2 ~ 5%', min: 2, max: 5, count: 0 },
      { label: '5 ~ 10%', min: 5, max: 10, count: 0 },
      { label: '> 10%', min: 10, max: Infinity, count: 0 }
    ];

    values.forEach(v => {
      for (const b of bins) {
        if (v >= b.min && v < b.max) {
          b.count++;
          break;
        }
      }
    });

    const labels = bins.map(b => b.label);
    const counts = bins.map(b => b.count);
    const colors = bins.map((b, idx) => idx < 4 ? 'rgba(59, 130, 246, 0.75)' : 'rgba(255, 67, 101, 0.75)');

    createOrUpdateChart('chartReturnDist', {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: '종목 수',
          data: counts,
          backgroundColor: colors,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  }

  function updateQuickMoversList() {
    const list = document.getElementById('quickMoversList');
    if (!list) return;

    const etfs = [...state.etfs];
    if (state.moversMode === 'gainers') {
      etfs.sort((a, b) => b.changeRate - a.changeRate);
    } else {
      etfs.sort((a, b) => a.changeRate - b.changeRate);
    }

    const topItems = etfs.slice(0, 10);
    list.innerHTML = topItems.map((item, idx) => {
      const cls = item.changeRate > 0 ? 'up' : item.changeRate < 0 ? 'down' : 'steady';
      const sign = item.changeRate > 0 ? '+' : '';
      return `
        <div class="rank-card-item" onclick="openDetailModal('${item.code}')">
          <div class="rank-item-left">
            <span class="rank-badge ${idx < 3 ? 'top-' + (idx + 1) : ''}">${idx + 1}</span>
            <div>
              <div class="rank-name">${escapeHtml(item.name)}</div>
              <div class="rank-code">${item.code} · ${item.brand}</div>
            </div>
          </div>
          <div style="text-align: right;">
            <div class="num font-weight-bold" style="color: #fff;">${formatNumber(item.currentPrice)}원</div>
            <div class="return-cell ${cls}" style="font-size: 0.8rem;">${sign}${item.changeRate.toFixed(2)}%</div>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * 2. Issuers & Brands Tab Charts
   */
  function renderIssuersCharts() {
    const etfs = state.etfs;
    if (!etfs.length) return;

    const counts = {};
    const returns1m = {};
    const returns6m = {};

    etfs.forEach(e => {
      counts[e.brand] = (counts[e.brand] || 0) + 1;
      if (e.returnRate1m !== null) {
        if (!returns1m[e.brand]) returns1m[e.brand] = [];
        returns1m[e.brand].push(e.returnRate1m);
      }
      if (e.returnRate6m !== null) {
        if (!returns6m[e.brand]) returns6m[e.brand] = [];
        returns6m[e.brand].push(e.returnRate6m);
      }
    });

    const sortedBrands = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 10);
    const countData = sortedBrands.map(b => counts[b]);

    createOrUpdateChart('chartBrandCounts', {
      type: 'bar',
      data: {
        labels: sortedBrands,
        datasets: [{
          label: '상장 종목 수',
          data: countData,
          backgroundColor: 'rgba(99, 102, 241, 0.75)',
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#fff', font: { weight: 600 } }, grid: { display: false } }
        },
        plugins: { legend: { display: false } }
      }
    });

    // Returns comparison for top brands
    const avg1m = sortedBrands.map(b => {
      const arr = returns1m[b] || [];
      return arr.length ? (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2) : 0;
    });
    const avg6m = sortedBrands.map(b => {
      const arr = returns6m[b] || [];
      return arr.length ? (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2) : 0;
    });

    createOrUpdateChart('chartBrandReturns', {
      type: 'bar',
      data: {
        labels: sortedBrands,
        datasets: [
          {
            label: '평균 1M 수익률 (%)',
            data: avg1m,
            backgroundColor: 'rgba(6, 182, 212, 0.75)',
            borderRadius: 4
          },
          {
            label: '평균 6M 수익률 (%)',
            data: avg6m,
            backgroundColor: 'rgba(245, 158, 11, 0.75)',
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        },
        plugins: { legend: { labels: { color: '#94a3b8' } } }
      }
    });
  }

  /**
   * 3. Category & Theme Charts
   */
  function renderCategoryCharts() {
    const etfs = state.etfs;
    if (!etfs.length) return;

    // Sub-category distribution
    const subCatMap = {};
    etfs.forEach(e => {
      const t = e.etfType || '기타';
      subCatMap[t] = (subCatMap[t] || 0) + 1;
    });

    const sortedSubCats = Object.entries(subCatMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const subLabels = sortedSubCats.map(s => s[0]);
    const subCounts = sortedSubCats.map(s => s[1]);

    createOrUpdateChart('chartSubCategory', {
      type: 'bar',
      data: {
        labels: subLabels,
        datasets: [{
          label: '종목 수',
          data: subCounts,
          backgroundColor: 'rgba(16, 185, 129, 0.75)',
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#cbd5e1' }, grid: { display: false } }
        },
        plugins: { legend: { display: false } }
      }
    });

    // Special ETF characteristics
    let activeCnt = 0, dividendCnt = 0, leverageCnt = 0, hedgedCnt = 0, trCnt = 0;
    etfs.forEach(e => {
      if (e.isActive) activeCnt++;
      if (e.isDividend) dividendCnt++;
      if (e.isLeverage) leverageCnt++;
      if (e.isHedged) hedgedCnt++;
      if (e.isTR) trCnt++;
    });

    createOrUpdateChart('chartSpecialTypes', {
      type: 'bar',
      data: {
        labels: ['액티브(Active)', '배당/월배당', '레버리지/인버스', '환헤지(H)', 'TR(토탈리턴)'],
        datasets: [{
          label: '종목 수',
          data: [activeCnt, dividendCnt, leverageCnt, hedgedCnt, trCnt],
          backgroundColor: [
            'rgba(56, 189, 248, 0.75)',
            'rgba(245, 158, 11, 0.75)',
            'rgba(244, 63, 94, 0.75)',
            'rgba(168, 85, 247, 0.75)',
            'rgba(16, 185, 129, 0.75)'
          ],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  /**
   * 4. Returns & Momentum Charts
   */
  function renderReturnsAndMomentumCharts() {
    const etfs = state.etfs;
    if (!etfs.length) return;

    // Momentum scatter (1M Return vs 6M Return)
    const points = etfs
      .filter(e => e.returnRate1m !== null && e.returnRate6m !== null && e.totalNetAssets >= 1e10) // at least 10 billion KRW for clean visual
      .map(e => ({
        x: e.returnRate1m,
        y: e.returnRate6m,
        name: e.name,
        code: e.code,
        aum: e.aumInBillion
      }));

    createOrUpdateChart('chartMomentumMatrix', {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'ETF 종목 (순자산 100억 이상)',
          data: points,
          backgroundColor: 'rgba(56, 189, 248, 0.6)',
          borderColor: '#38bdf8',
          borderWidth: 1,
          pointRadius: 4,
          pointHoverRadius: 7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: { display: true, text: '1개월 수익률 (%)', color: '#94a3b8' },
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(255,255,255,0.06)' }
          },
          y: {
            title: { display: true, text: '6개월 수익률 (%)', color: '#94a3b8' },
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(255,255,255,0.06)' }
          }
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const p = ctx.raw;
                return ` [${p.code}] ${p.name}: 1M: ${p.x.toFixed(2)}%, 6M: ${p.y.toFixed(2)}% (순자산 ${Math.round(p.aum)}억)`;
              }
            }
          }
        }
      }
    });

    // Statistical EDA Summary Container
    renderStatsSummary();
  }

  function renderStatsSummary() {
    const container = document.getElementById('statsSummaryContainer');
    if (!container) return;

    const periods = [
      { key: 'changeRate', label: '당일 등락률' },
      { key: 'returnRate1m', label: '1개월 수익률' },
      { key: 'returnRate3m', label: '3개월 수익률' },
      { key: 'returnRate6m', label: '6개월 수익률' }
    ];

    const stats = periods.map(p => {
      const vals = state.etfs.map(e => e[p.key]).filter(v => v !== null && !isNaN(v)).sort((a, b) => a - b);
      if (!vals.length) return null;
      const count = vals.length;
      const sum = vals.reduce((a, b) => a + b, 0);
      const mean = sum / count;
      const median = vals[Math.floor(count / 2)];
      const min = vals[0];
      const max = vals[vals.length - 1];
      const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / count;
      const stdDev = Math.sqrt(variance);

      return {
        label: p.label,
        count,
        mean: mean.toFixed(2),
        median: median.toFixed(2),
        min: min.toFixed(2),
        max: max.toFixed(2),
        stdDev: stdDev.toFixed(2)
      };
    }).filter(Boolean);

    container.innerHTML = `
      <table class="etf-table" style="font-size: 0.82rem;">
        <thead>
          <tr>
            <th>구분</th>
            <th class="text-right">표본수</th>
            <th class="text-right">평균 (%)</th>
            <th class="text-right">중앙값 (%)</th>
            <th class="text-right">최저 (%)</th>
            <th class="text-right">최고 (%)</th>
            <th class="text-right">표준편차</th>
          </tr>
        </thead>
        <tbody>
          ${stats.map(s => `
            <tr>
              <td style="font-weight: 700; color: #fff;">${s.label}</td>
              <td class="text-right tabular">${formatNumber(s.count)}</td>
              <td class="text-right tabular" style="color: ${s.mean >= 0 ? 'var(--color-up)' : 'var(--color-down)'}; font-weight: 600;">${s.mean}%</td>
              <td class="text-right tabular">${s.median}%</td>
              <td class="text-right tabular color-down-text">${s.min}%</td>
              <td class="text-right tabular color-up-text">${s.max}%</td>
              <td class="text-right tabular" style="color: #cbd5e1;">${s.stdDev}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  /**
   * 5. Liquidity & Scale Chart
   */
  function renderLiquidityChart() {
    const etfs = state.etfs;
    if (!etfs.length) return;

    // Filter out 0 trading value or 0 AUM for log scale
    const points = etfs
      .filter(e => e.aumInBillion > 0 && e.tradingValueInBillion > 0)
      .map(e => ({
        x: Math.log10(e.aumInBillion), // log10 AUM
        y: Math.log10(e.tradingValueInBillion), // log10 Value
        rawAum: e.aumInBillion,
        rawValue: e.tradingValueInBillion,
        name: e.name,
        code: e.code,
        changeRate: e.changeRate,
        turnoverRate: e.turnoverRate
      }));

    createOrUpdateChart('chartLiquidityScatter', {
      type: 'scatter',
      data: {
        datasets: [{
          label: '전체 ETF (Log-Scale 유동성 매트릭스)',
          data: points,
          backgroundColor: (ctx) => {
            const raw = ctx.raw;
            if (!raw) return 'rgba(56, 189, 248, 0.6)';
            return raw.changeRate > 0 ? 'rgba(255, 67, 101, 0.65)' : raw.changeRate < 0 ? 'rgba(59, 130, 246, 0.65)' : 'rgba(148, 163, 184, 0.5)';
          },
          borderWidth: 0,
          pointRadius: 4.5,
          pointHoverRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: { display: true, text: '순자산총액 log10 (1=10억, 2=100억, 3=1천억, 4=1조원)', color: '#94a3b8' },
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(255,255,255,0.06)' }
          },
          y: {
            title: { display: true, text: '당일 거래대금 log10 (0=1억, 1=10억, 2=100억, 3=1천억)', color: '#94a3b8' },
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(255,255,255,0.06)' }
          }
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const p = ctx.raw;
                return ` [${p.code}] ${p.name} | AUM: ${Math.round(p.rawAum)}억 | 거래대금: ${p.rawValue.toFixed(1)}억 | 등락: ${p.changeRate}%`;
              }
            }
          }
        }
      }
    });
  }

  /**
   * 6. Disparity Charts & Risk Watchlist
   */
  function renderDisparityCharts() {
    const etfs = state.etfs;
    if (!etfs.length) return;

    // Disparity Bins
    const bins = [
      { label: '< -1.5%', min: -Infinity, max: -1.5, count: 0 },
      { label: '-1.5 ~ -0.5%', min: -1.5, max: -0.5, count: 0 },
      { label: '-0.5 ~ -0.1%', min: -0.5, max: -0.1, count: 0 },
      { label: '-0.1 ~ +0.1% (안정)', min: -0.1, max: 0.1, count: 0 },
      { label: '+0.1 ~ +0.5%', min: 0.1, max: 0.5, count: 0 },
      { label: '+0.5 ~ +1.5%', min: 0.5, max: 1.5, count: 0 },
      { label: '> +1.5%', min: 1.5, max: Infinity, count: 0 }
    ];

    etfs.forEach(e => {
      if (e.iNav > 0) {
        for (const b of bins) {
          if (e.disparity >= b.min && e.disparity < b.max) {
            b.count++;
            break;
          }
        }
      }
    });

    const labels = bins.map(b => b.label);
    const counts = bins.map(b => b.count);
    const colors = [
      'rgba(239, 68, 68, 0.8)',
      'rgba(245, 158, 11, 0.7)',
      'rgba(56, 189, 248, 0.6)',
      'rgba(16, 185, 129, 0.85)',
      'rgba(56, 189, 248, 0.6)',
      'rgba(245, 158, 11, 0.7)',
      'rgba(239, 68, 68, 0.8)'
    ];

    createOrUpdateChart('chartDisparityDist', {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: '종목 수',
          data: counts,
          backgroundColor: colors,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        },
        plugins: { legend: { display: false } }
      }
    });

    // Top Disparity Outlier List
    const riskList = document.getElementById('disparityRiskList');
    if (!riskList) return;

    const outliers = [...etfs]
      .filter(e => e.iNav > 0)
      .sort((a, b) => b.absDisparity - a.absDisparity)
      .slice(0, 10);

    riskList.innerHTML = outliers.map((item, idx) => {
      const isWarn = item.absDisparity >= 2.0;
      return `
        <div class="rank-card-item" onclick="openDetailModal('${item.code}')">
          <div class="rank-item-left">
            <span class="rank-badge" style="${isWarn ? 'background: #ef4444; color: #fff;' : ''}">${idx + 1}</span>
            <div>
              <div class="rank-name">${escapeHtml(item.name)}</div>
              <div class="rank-code">${item.code} · ${item.assetClass}</div>
            </div>
          </div>
          <div style="text-align: right;">
            <span class="disparity-pill ${isWarn ? 'danger' : 'warn'}">
              ${item.disparity > 0 ? '+' : ''}${item.disparity.toFixed(2)}%
            </span>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">
              가: ${formatNumber(item.currentPrice)} / iNav: ${formatNumber(Math.round(item.iNav))}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Helper to safely create or replace Chart.js instances
  function createOrUpdateChart(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas) return;

    if (state.charts[id]) {
      state.charts[id].destroy();
    }

    state.charts[id] = new Chart(canvas, config);
  }

  // =========================================================================
  // DETAIL MODAL & POPUP
  // =========================================================================
  window.openDetailModal = function (code) {
    const etf = state.etfs.find(e => e.code === code);
    if (!etf) return;

    state.selectedEtf = etf;

    document.getElementById('detailItemName').textContent = etf.name;
    document.getElementById('detailItemCode').textContent = etf.code;

    const brandBadge = document.getElementById('detailBrandBadge');
    brandBadge.textContent = etf.brand;
    brandBadge.className = `badge-brand ${getBrandClass(etf.brand)}`;

    // Price
    const changeClass = etf.changeRate > 0 ? 'color-up-text' : etf.changeRate < 0 ? 'color-down-text' : 'color-steady-text';
    const changeSign = etf.changeRate > 0 ? '▲ +' : etf.changeRate < 0 ? '▼ ' : '― ';
    document.getElementById('detailPrice').textContent = `${formatNumber(etf.currentPrice)}원`;
    document.getElementById('detailChange').innerHTML = `<span class="${changeClass}">${changeSign}${formatNumber(etf.changePrice)}원 (${etf.changeRate.toFixed(2)}%)</span>`;

    // iNav & Disparity
    document.getElementById('detailInav').textContent = `${formatNumber(Math.round(etf.iNav))}원`;
    const dispSign = etf.disparity > 0 ? '+' : '';
    document.getElementById('detailDisparity').innerHTML = `
      <span class="disparity-pill ${etf.disparityLevel}">
        괴리율 ${dispSign}${etf.disparity.toFixed(2)}% (${etf.absDisparity >= 1.0 ? '주의' : '안정'})
      </span>
    `;

    // AUM & Rank
    document.getElementById('detailAum').textContent = formatAumWon(etf.totalNetAssets);
    const aumRank = [...state.etfs].sort((a, b) => b.totalNetAssets - a.totalNetAssets).findIndex(e => e.code === etf.code) + 1;
    document.getElementById('detailAumRank').textContent = `시장 전체 순위: ${aumRank}위 / ${state.etfs.length}개`;

    // Trading Value
    document.getElementById('detailTradingValue').textContent = `${formatNumber(Math.round(etf.tradingValue / 1e8))} 억원`;
    document.getElementById('detailVolume').textContent = `거래량: ${formatNumber(Math.round(etf.tradingVolume / 10000))} 만주`;

    // Category
    document.getElementById('detailCategory').textContent = `${etf.assetClass} (${etf.etfType})`;

    // Turnover
    document.getElementById('detailTurnover').textContent = `${etf.turnoverRate.toFixed(2)}%`;

    // Naver link
    const naverLink = document.getElementById('detailNaverLink');
    naverLink.href = `https://finance.naver.com/item/main.naver?code=${etf.code}`;

    // Period Returns Bar Chart in Modal
    renderDetailReturnChart(etf);

    const modal = document.getElementById('detailModal');
    modal.classList.add('open');
  };

  function renderDetailReturnChart(etf) {
    const labels = ['당일', '1개월', '3개월', '6개월'];
    const data = [
      etf.changeRate,
      etf.returnRate1m || 0,
      etf.returnRate3m || 0,
      etf.returnRate6m || 0
    ];
    const colors = data.map(v => v >= 0 ? 'rgba(255, 67, 101, 0.8)' : 'rgba(59, 130, 246, 0.8)');

    createOrUpdateChart('detailReturnChart', {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: '수익률 (%)',
          data,
          backgroundColor: colors,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  }

  // =========================================================================
  // WATCHLIST & CSV EXPORT
  // =========================================================================
  function toggleWatchlist(code) {
    if (state.watchlist.has(code)) {
      state.watchlist.delete(code);
    } else {
      state.watchlist.add(code);
    }
    localStorage.setItem('etf_watchlist', JSON.stringify(Array.from(state.watchlist)));
    updateWatchlistCount();
    renderTable();
  }

  function updateWatchlistCount() {
    const el = document.getElementById('watchlistCount');
    if (el) el.textContent = state.watchlist.size;
  }

  function exportCsv() {
    const items = state.filtered;
    if (!items.length) {
      alert('내보낼 데이터가 없습니다.');
      return;
    }

    const headers = [
      '종목코드',
      '종목명',
      '운용사(브랜드)',
      '자산군',
      '세부유형',
      '현재가(원)',
      '등락률(%)',
      'iNav(원)',
      '괴리율(%)',
      '순자산총액(원)',
      '거래대금(원)',
      '거래량(주)',
      '1개월수익률(%)',
      '3개월수익률(%)',
      '6개월수익률(%)',
      '액티브여부',
      '배당여부',
      '레버리지여부'
    ];

    const rows = items.map(e => [
      `"${e.code}"`,
      `"${e.name.replace(/"/g, '""')}"`,
      `"${e.brand}"`,
      `"${e.assetClass}"`,
      `"${e.etfType}"`,
      e.currentPrice,
      e.changeRate,
      e.iNav,
      e.disparity.toFixed(2),
      e.totalNetAssets,
      e.tradingValue,
      e.tradingVolume,
      e.returnRate1m ?? '',
      e.returnRate3m ?? '',
      e.returnRate6m ?? '',
      e.isActive ? 'Y' : 'N',
      e.isDividend ? 'Y' : 'N',
      e.isLeverage ? 'Y' : 'N'
    ]);

    // Prepend UTF-8 BOM so Excel opens with correct Korean encoding
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `KRX_ETF_EDA_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // =========================================================================
  // EVENT LISTENERS
  // =========================================================================
  function initEventListeners() {
    // Live refresh button
    document.getElementById('btnLiveRefresh').addEventListener('click', () => {
      fetchLiveNaverEtfs();
    });

    // Watchlist toggle button in header
    document.getElementById('btnToggleWatchlist').addEventListener('click', () => {
      state.watchlistOnly = !state.watchlistOnly;
      const btn = document.getElementById('btnToggleWatchlist');
      if (state.watchlistOnly) {
        btn.classList.add('active');
        btn.style.borderColor = '#f59e0b';
      } else {
        btn.classList.remove('active');
        btn.style.borderColor = '';
      }
      applyFilters();
    });

    // Search input
    let searchTimeout;
    document.getElementById('searchInput').addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        state.searchQuery = e.target.value;
        applyFilters();
      }, 150);
    });

    // Sort select
    document.getElementById('sortColumnSelect').addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'changeRateAsc') {
        state.sortColumn = 'changeRate';
        state.sortDirection = 'asc';
      } else {
        state.sortColumn = val;
        state.sortDirection = 'desc';
      }
      applyFilters();
    });

    // Page size select
    document.getElementById('pageSizeSelect').addEventListener('change', (e) => {
      state.pageSize = parseInt(e.target.value, 10);
      state.currentPage = 1;
      renderTable();
    });

    // CSV Export button
    document.getElementById('btnExportCsv').addEventListener('click', exportCsv);

    // Brand chips
    const brandChips = document.getElementById('brandChipsContainer');
    if (brandChips) {
      brandChips.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip-btn');
        if (!btn) return;
        brandChips.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedBrand = btn.getAttribute('data-brand');
        applyFilters();
      });
    }

    // Asset chips
    const assetChips = document.getElementById('assetChipsContainer');
    if (assetChips) {
      assetChips.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip-btn');
        if (!btn) return;
        assetChips.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedAsset = btn.getAttribute('data-asset');
        applyFilters();
      });
    }

    // Special filter chips (multi-toggle)
    const specialChips = document.getElementById('specialFilterChips');
    if (specialChips) {
      specialChips.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip-btn');
        if (!btn) return;
        const filterKey = btn.getAttribute('data-special');
        if (state.activeSpecialFilters.has(filterKey)) {
          state.activeSpecialFilters.delete(filterKey);
          btn.classList.remove('active');
        } else {
          state.activeSpecialFilters.add(filterKey);
          btn.classList.add('active');
        }
        applyFilters();
      });
    }

    // Table Header Click Sort
    document.querySelectorAll('#etfMasterTable th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-sort');
        if (state.sortColumn === col) {
          state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortColumn = col;
          state.sortDirection = 'desc';
        }
        // Update header classes
        document.querySelectorAll('#etfMasterTable th').forEach(t => t.classList.remove('sorted-asc', 'sorted-desc'));
        th.classList.add(state.sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');
        applyFilters();
      });
    });

    // Pagination buttons
    document.getElementById('btnFirstPage').addEventListener('click', () => {
      state.currentPage = 1;
      renderTable();
    });
    document.getElementById('btnPrevPage').addEventListener('click', () => {
      if (state.currentPage > 1) {
        state.currentPage--;
        renderTable();
      }
    });
    document.getElementById('btnNextPage').addEventListener('click', () => {
      const totalPages = Math.ceil(state.filtered.length / state.pageSize) || 1;
      if (state.currentPage < totalPages) {
        state.currentPage++;
        renderTable();
      }
    });
    document.getElementById('btnLastPage').addEventListener('click', () => {
      const totalPages = Math.ceil(state.filtered.length / state.pageSize) || 1;
      state.currentPage = totalPages;
      renderTable();
    });

    // EDA Navigation Tabs
    const edaTabs = document.getElementById('edaTabs');
    if (edaTabs) {
      edaTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.eda-tab-btn');
        if (!btn) return;

        edaTabs.querySelectorAll('.eda-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const targetTab = btn.getAttribute('data-tab');
        state.activeTab = targetTab;

        // Switch panels
        document.querySelectorAll('.tab-pane').forEach(p => {
          p.style.display = 'none';
        });

        const targetPane = document.getElementById(`pane-${targetTab}`);
        if (targetPane) {
          targetPane.style.display = 'block';
        }

        // Trigger chart resize/re-render
        setTimeout(() => {
          Object.values(state.charts).forEach(c => c && c.resize && c.resize());
        }, 50);
      });
    }

    // Return period switcher on Overview histogram
    document.querySelectorAll('.chart-actions button[data-period]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.chart-actions button[data-period]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeReturnPeriod = btn.getAttribute('data-period');
        updateReturnDistributionChart();
      });
    });

    // Quick movers toggle
    const gainerBtn = document.getElementById('btnToggleGainerLoser');
    const loserBtn = document.getElementById('btnToggleGainerLoser2');
    if (gainerBtn && loserBtn) {
      gainerBtn.addEventListener('click', () => {
        gainerBtn.classList.add('active');
        loserBtn.classList.remove('active');
        state.moversMode = 'gainers';
        updateQuickMoversList();
      });
      loserBtn.addEventListener('click', () => {
        loserBtn.classList.add('active');
        gainerBtn.classList.remove('active');
        state.moversMode = 'losers';
        updateQuickMoversList();
      });
    }

    // Modal Close buttons
    document.getElementById('btnCloseDetailModal').addEventListener('click', () => {
      document.getElementById('detailModal').classList.remove('open');
    });
    document.getElementById('detailModal').addEventListener('click', (e) => {
      if (e.target.id === 'detailModal') {
        document.getElementById('detailModal').classList.remove('open');
      }
    });

    // Settings Modal
    document.getElementById('btnOpenSettings').addEventListener('click', () => {
      document.getElementById('settingsModal').classList.add('open');
    });
    document.getElementById('btnCloseSettingsModal').addEventListener('click', () => {
      document.getElementById('settingsModal').classList.remove('open');
    });
    document.getElementById('btnCancelSettings').addEventListener('click', () => {
      document.getElementById('settingsModal').classList.remove('open');
    });
    document.getElementById('settingsModal').addEventListener('click', (e) => {
      if (e.target.id === 'settingsModal') {
        document.getElementById('settingsModal').classList.remove('open');
      }
    });

    document.getElementById('btnSaveSettings').addEventListener('click', () => {
      const selectedRadio = document.querySelector('input[name="apiMode"]:checked');
      if (selectedRadio) {
        state.apiMode = selectedRadio.value;
        localStorage.setItem('etf_api_mode', state.apiMode);
      }
      const proxyInput = document.getElementById('customProxyInput');
      if (proxyInput) {
        state.customProxy = proxyInput.value.trim();
        localStorage.setItem('etf_custom_proxy', state.customProxy);
      }
      document.getElementById('settingsModal').classList.remove('open');
      fetchLiveNaverEtfs();
    });

    // Keyboard shortcuts (Escape closes modals)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.getElementById('detailModal').classList.remove('open');
        document.getElementById('settingsModal').classList.remove('open');
      }
    });
  }

  // =========================================================================
  // UTILITY HELPERS
  // =========================================================================
  function formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '-';
    return Number(num).toLocaleString('ko-KR');
  }

  function formatAumWon(won) {
    if (!won || isNaN(won)) return '-';
    if (won >= 1e12) {
      return `${(won / 1e12).toFixed(2)} 조원`;
    }
    return `${formatNumber(Math.round(won / 1e8))} 억원`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

})();
