// ===============================
// COCO'S AI TRADING DASHBOARD
// JavaScript Logic File
// ===============================
// This file controls:
// 1. Live Binance market data
// 2. Dynamic symbol search
// 3. Candlestick chart rendering
// 4. EMA, RSI, trend, volume and signal calculations
// 5. Market scanner table
// 6. Risk management calculator

// These are Binance candle-data API endpoints.
// We keep two endpoints so the app has a backup if one fails.
const API_BASES = [
  "https://data-api.binance.vision/api/v3/klines",
  "https://api.binance.com/api/v3/klines"
];

// These are Binance exchange-info API endpoints.
// They return all valid Binance trading symbols like BTCUSDT, ETHBTC, DOGEUSDT, etc.
const EXCHANGE_INFO_BASES = [
  "https://data-api.binance.vision/api/v3/exchangeInfo",
  "https://api.binance.com/api/v3/exchangeInfo"
];

// These pairs are used for the market scanner table.
// The search bar will support all Binance pairs, but scanning thousands at once would be slow for the browser.
const scannerPairs = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "AVAXUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "LINKUSDT",
  "ADAUSDT",
  "SUIUSDT",
  "PEPEUSDT",
  "NEARUSDT"
];

// This variable stores every tradable Binance symbol after we load exchangeInfo.
let allSymbols = [];

// This variable stores Binance symbol metadata, such as base asset and quote asset.
let symbolDetails = {};

// This variable will hold the Lightweight Charts chart instance.
let chart;

// This variable will hold the candlestick series on the chart.
let candleSeries;

// This keeps track of the pair currently displayed on the main chart.
let selectedPair = "BTCUSDT";

// This converts raw Binance symbols into a more readable format.
// Example: BTCUSDT becomes BTC/USDT.
function formatPair(pair) {
  const details = symbolDetails[pair];

  if (details) {
    return `${details.baseAsset}/${details.quoteAsset}`;
  }

  return pair
    .replace("USDT", "/USDT")
    .replace("USDC", "/USDC")
    .replace("FDUSD", "/FDUSD")
    .replace("BTC", "/BTC")
    .replace("ETH", "/ETH")
    .replace("BNB", "/BNB");
}

// This formats raw price numbers into dollar-style readable values.
// Example: 62450.245 becomes $62,450.25.
function formatPrice(price) {
  return `$${Number(price).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8
  })}`;
}

// This loads every valid Binance trading pair.
// It runs once when the app starts.
async function loadExchangeSymbols() {
  let lastError;

  for (const apiBase of EXCHANGE_INFO_BASES) {
    try {
      const response = await fetch(apiBase);

      if (!response.ok) {
        throw new Error(`Exchange info request returned ${response.status}`);
      }

      const data = await response.json();

      allSymbols = data.symbols
        .filter(symbol => symbol.status === "TRADING")
        .map(symbol => symbol.symbol);

      symbolDetails = data.symbols.reduce((details, symbol) => {
        if (symbol.status === "TRADING") {
          details[symbol.symbol] = {
            baseAsset: symbol.baseAsset,
            quoteAsset: symbol.quoteAsset
          };
        }

        return details;
      }, {});

      console.log(`Loaded ${allSymbols.length} Binance trading pairs.`);
      return;
    } catch (error) {
      lastError = error;
      console.warn(`Could not load exchange symbols from ${apiBase}`, error);
    }
  }

  throw new Error(lastError?.message || "Could not load Binance symbols");
}

// This fetches candle data from Binance.
// A candle contains open, high, low, close and volume for a time period.
async function fetchCandles(symbol = "BTCUSDT", interval = "4h", limit = 150) {
  let lastError;

  for (const apiBase of API_BASES) {
    try {
      const url = `${apiBase}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Market data request returned ${response.status}`);
      }

      const data = await response.json();

      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("Market data response was empty");
      }

      return data.map(candle => ({
        time: candle[0] / 1000,
        open: Number(candle[1]),
        high: Number(candle[2]),
        low: Number(candle[3]),
        close: Number(candle[4]),
        volume: Number(candle[5])
      }));
    } catch (error) {
      lastError = error;
      console.warn(`Could not load data from ${apiBase}`, error);
    }
  }

  throw new Error(
    `Market data is temporarily unavailable. Please try again. (${lastError?.message || "Network error"})`
  );
}

// This calculates the Exponential Moving Average.
// EMA gives more importance to recent price action than older candles.
function calculateEMA(candles, period = 50) {
  const closes = candles.map(candle => candle.close);
  const multiplier = 2 / (period + 1);

  let ema = closes[0];

  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * multiplier + ema * (1 - multiplier);
  }

  return ema;
}

// This calculates RSI.
// RSI helps estimate momentum and whether price may be overbought or oversold.
function calculateRSI(candles, period = 14) {
  const closes = candles.map(candle => candle.close);

  let gains = 0;
  let losses = 0;

  for (let i = closes.length - period; i < closes.length - 1; i++) {
    const difference = closes[i + 1] - closes[i];

    if (difference >= 0) {
      gains += difference;
    } else {
      losses += Math.abs(difference);
    }
  }

  const averageGain = gains / period;
  const averageLoss = losses / period;

  if (averageLoss === 0) return 100;

  const rs = averageGain / averageLoss;
  return 100 - 100 / (1 + rs);
}

// This checks whether the latest volume is stronger than recent average volume.
function calculateVolumeStrength(candles) {
  const recentVolume = candles[candles.length - 1].volume;

  const averageVolume =
    candles.slice(-21, -1).reduce((sum, candle) => sum + candle.volume, 0) / 20;

  return recentVolume > averageVolume ? "Strong" : "Weak";
}

// This calculates basic trade levels.
// Support is the lowest low from recent candles.
// Resistance is the highest high from recent candles.
// Stop loss and take profit are calculated using a basic 1:2 risk-reward model.
function calculateTradeLevels(candles, direction) {
  const lastCandle = candles[candles.length - 1];
  const recentCandles = candles.slice(-30);
  const support = Math.min(...recentCandles.map(candle => candle.low));
  const resistance = Math.max(...recentCandles.map(candle => candle.high));
  const entry = lastCandle.close;

  if (direction === "SHORT") {
    const stopLoss = resistance;
    const riskDistance = Math.abs(stopLoss - entry);
    const takeProfit = entry - riskDistance * 2;

    return {
      entry,
      stopLoss,
      takeProfit,
      support,
      resistance,
      riskReward: 2
    };
  }

  const stopLoss = support;
  const riskDistance = Math.abs(entry - stopLoss);
  const takeProfit = entry + riskDistance * 2;

  return {
    entry,
    stopLoss,
    takeProfit,
    support,
    resistance,
    riskReward: 2
  };
}

// This detects the current trend using EMA structure.
// Bullish means price is above EMA50 and EMA50 is above EMA100.
// Bearish means price is below EMA50 and EMA50 is below EMA100.
function detectTrend(candles) {
  const lastClose = candles[candles.length - 1].close;
  const ema50 = calculateEMA(candles, 50);
  const ema100 = calculateEMA(candles, 100);

  if (lastClose > ema50 && ema50 > ema100) {
    return "Bullish";
  }

  if (lastClose < ema50 && ema50 < ema100) {
    return "Bearish";
  }

  return "Neutral";
}

// This is the main signal engine.
// It combines trend, EMA, RSI, volume and candle direction into a confidence score.
function calculateSignal(candles) {
  const lastCandle = candles[candles.length - 1];
  const previousCandle = candles[candles.length - 2];

  const rsi = calculateRSI(candles);
  const ema50 = calculateEMA(candles, 50);
  const trend = detectTrend(candles);
  const volumeStrength = calculateVolumeStrength(candles);

  let score = 0;
  const reasons = [];

  if (trend === "Bullish") {
    score += 25;
    reasons.push("Market structure is bullish.");
  }

  if (trend === "Bearish") {
    score += 25;
    reasons.push("Market structure is bearish.");
  }

  if (lastCandle.close > ema50) {
    score += 20;
    reasons.push("Price is trading above the 50 EMA.");
  }

  if (rsi >= 45 && rsi <= 70) {
    score += 20;
    reasons.push("RSI is healthy and not overbought.");
  }

  if (volumeStrength === "Strong") {
    score += 20;
    reasons.push("Recent volume is stronger than average.");
  }

  if (lastCandle.close > previousCandle.close) {
    score += 15;
    reasons.push("Latest candle closed bullish.");
  }

  let direction = "WAIT";

  if (score >= 70 && trend === "Bullish") {
    direction = "LONG";
  } else if (score >= 70 && trend === "Bearish") {
    direction = "SHORT";
  }

  if (direction === "WAIT") {
    reasons.push("No confirmed trade yet. Waiting protects the account from weak setups.");
  }

  const levels = calculateTradeLevels(candles, direction);

  return {
    score,
    direction,
    rsi,
    trend,
    volumeStrength,
    reasons,
    levels,
    price: lastCandle.close,
    change:
      ((lastCandle.close - previousCandle.close) / previousCandle.close) * 100
  };
}

// This creates the chart area using Lightweight Charts.
function createChart() {
  if (typeof LightweightCharts === "undefined") {
    const chartElement = document.getElementById("chart");
    chartElement.classList.add("chart-error");
    chartElement.textContent = "The price chart could not be loaded. Check your internet connection and refresh.";
    return;
  }

  chart = LightweightCharts.createChart(document.getElementById("chart"), {
    layout: {
      background: { color: "#0d1b2e" },
      textColor: "#b8c7da"
    },
    grid: {
      vertLines: { color: "#17263a" },
      horzLines: { color: "#17263a" }
    },
    rightPriceScale: {
      borderColor: "#1d2b3f"
    },
    timeScale: {
      borderColor: "#1d2b3f"
    }
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: "#12b76a",
    downColor: "#f04438",
    borderUpColor: "#12b76a",
    borderDownColor: "#f04438",
    wickUpColor: "#12b76a",
    wickDownColor: "#f04438"
  });
}

// This updates the main dashboard with the newest signal result.
function updateDashboard(signal, pair) {
  document.getElementById("pairTitle").textContent = formatPair(pair);
  document.getElementById("pairSubtitle").textContent = `${formatPair(pair)} · 4h · Binance`;
  document.getElementById("currentPrice").textContent = formatPrice(signal.price);
  document.getElementById("chartPrice").textContent = formatPrice(signal.price);

  document.getElementById("priceChange").textContent =
    `${signal.change.toFixed(2)}% last candle`;

  document.getElementById("chartChange").textContent =
    `${signal.change.toFixed(2)}%`;

  document.getElementById("marketOutlook").textContent = signal.trend.toUpperCase();
  document.getElementById("entryLevel").textContent = `Entry: ${formatPrice(signal.levels.entry)}`;
  document.getElementById("stopLossLevel").textContent = `Stop Loss: ${formatPrice(signal.levels.stopLoss)}`;
  document.getElementById("takeProfitLevel").textContent = `Take Profit: ${formatPrice(signal.levels.takeProfit)}`;

  document.getElementById("signalDirection").textContent = signal.direction;
  document.getElementById("confidenceScore").textContent = `${signal.score}%`;

  document.getElementById("setupBadge").textContent =
    signal.score >= 80 ? "Strong Setup" : signal.score >= 60 ? "Moderate Setup" : "Weak Setup";

  document.getElementById("signalText").textContent =
    signal.direction === "WAIT"
      ? "No high-probability trade yet. Wait for better confirmation."
      : `${signal.direction} setup detected with ${signal.trend.toLowerCase()} market structure.`;

  const reasonList = document.getElementById("reasonList");
  reasonList.innerHTML = "";

  signal.reasons.forEach(reason => {
    const li = document.createElement("li");
    li.textContent = reason;
    reasonList.appendChild(li);
  });
}

// This loads the selected pair into the main chart.
async function loadMainChart(pair = selectedPair) {
  try {
    selectedPair = pair;
    const candles = await fetchCandles(pair, "4h", 150);
    candleSeries?.setData(candles);

    const signal = calculateSignal(candles);
    updateDashboard(signal, pair);
  } catch (error) {
    console.error(error);
    document.getElementById("marketOutlook").textContent = "UNAVAILABLE";
    document.getElementById("priceChange").textContent = error.message;
    document.getElementById("setupBadge").textContent = "Offline";
    document.getElementById("signalText").textContent =
      "Live market data could not be loaded. Use Refresh Analysis to try again.";
  }
}

// This scans the default scanner pairs and displays their signals in the table.
async function scanMarket() {
  const table = document.getElementById("scannerTable");
  table.innerHTML = "";

  let best = {
    pair: "BTCUSDT",
    score: 0
  };

  for (const pair of scannerPairs) {
    try {
      const candles = await fetchCandles(pair, "4h", 150);
      const signal = calculateSignal(candles);

      if (signal.score > best.score) {
        best = {
          pair,
          score: signal.score
        };
      }

      const row = document.createElement("tr");
      row.dataset.pair = pair;

      if (pair === selectedPair) {
        row.classList.add("active-row");
      }

      row.innerHTML = `
        <td>${formatPair(pair)}</td>
        <td class="${signal.direction === "SHORT" ? "red" : signal.direction === "LONG" ? "green" : "blue"}">
          ${signal.direction}
        </td>
        <td>${signal.rsi.toFixed(1)}</td>
        <td>${signal.score}%</td>
        <td>${formatPrice(signal.levels.entry)}</td>
        <td>${formatPrice(signal.levels.stopLoss)}</td>
        <td>${formatPrice(signal.levels.takeProfit)}</td>
        <td>${signal.score >= 70 ? "Trade Setup" : "Wait"}</td>
      `;

      row.addEventListener("click", () => {
        document.querySelectorAll("#scannerTable tr").forEach(tableRow => {
          tableRow.classList.remove("active-row");
        });

        row.classList.add("active-row");
        loadMainChart(pair);
      });

      table.appendChild(row);
    } catch (error) {
      console.error(`Could not scan ${pair}`, error);
    }
  }

  document.getElementById("bestPair").textContent = formatPair(best.pair);
  document.getElementById("bestConfidence").textContent = `${best.score}% Confidence`;
}

// This calculates how much position size to use based on account risk.
function calculateRisk() {
  const balance = Number(document.getElementById("balance").value);
  const riskPercent = Number(document.getElementById("riskPercent").value);
  const entryPrice = Number(document.getElementById("entryPrice").value);
  const stopLoss = Number(document.getElementById("stopLoss").value);

  const output = document.getElementById("riskOutput");

  if (!balance || !riskPercent || !entryPrice || !stopLoss || entryPrice === stopLoss) {
    output.innerHTML = "Please enter valid values.";
    return;
  }

  const riskAmount = balance * (riskPercent / 100);
  const stopDistance = Math.abs(entryPrice - stopLoss);
  const positionSize = riskAmount / stopDistance;

  output.innerHTML = `
    <strong>Risk Amount:</strong> $${riskAmount.toFixed(2)} <br>
    <strong>Stop Distance:</strong> $${stopDistance.toFixed(2)} <br>
    <strong>Position Size:</strong> ${positionSize.toFixed(5)} units
  `;
}

// This converts user input into a valid Binance symbol.
// Examples:
// BTC becomes BTCUSDT.
// DOGE becomes DOGEUSDT.
// ETHBTC remains ETHBTC.
// SOL/USDC becomes SOLUSDC.
function findMatchingSymbol(searchValue) {
  const cleanedSearch = searchValue.trim().toUpperCase().replace("/", "");

  if (!cleanedSearch) return null;

  const possibleSymbols = [
    cleanedSearch,
    `${cleanedSearch}USDT`,
    `${cleanedSearch}USDC`,
    `${cleanedSearch}FDUSD`,
    `${cleanedSearch}BTC`,
    `${cleanedSearch}ETH`,
    `${cleanedSearch}BNB`
  ];

  return possibleSymbols.find(symbol => allSymbols.includes(symbol));
}

// This runs when the user searches from the input box.
function handleSearch() {
  const searchValue = document.getElementById("searchInput").value;
  const matchedSymbol = findMatchingSymbol(searchValue);

  if (!matchedSymbol) {
    const cleanedSearch = searchValue.trim().toUpperCase().replace("/", "");

    const suggestions = allSymbols
      .filter(symbol => symbol.includes(cleanedSearch))
      .slice(0, 8);

    alert(
      suggestions.length
        ? `Pair not found. Did you mean: ${suggestions.join(", ")}?`
        : "Pair not found on Binance. Try examples like DOGE, XRP, PEPE, ETHBTC, or SOLUSDC."
    );

    return;
  }

  loadMainChart(matchedSymbol);
}

// This connects the buttons and input fields to JavaScript functions.
document.getElementById("refreshBtn").addEventListener("click", () => loadMainChart(selectedPair));

document.getElementById("searchInput").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    handleSearch();
  }
});

document.getElementById("scanBtn").addEventListener("click", scanMarket);
document.getElementById("riskBtn").addEventListener("click", calculateRisk);

// This starts the app in the correct order.
async function startApp() {
  createChart();

  try {
    await loadExchangeSymbols();
  } catch (error) {
    console.warn(error);
  }

  loadMainChart();
  scanMarket();
  calculateRisk();
}

startApp();
