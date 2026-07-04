const API_BASES = [
  "https://data-api.binance.vision/api/v3/klines",
  "https://api.binance.com/api/v3/klines"
];

const pairs = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "AVAXUSDT"];

let chart;
let candleSeries;
let selectedPair = "BTCUSDT";

const pairNames = {
  BTCUSDT: "Bitcoin / Tether",
  ETHUSDT: "Ethereum / Tether",
  SOLUSDT: "Solana / Tether",
  BNBUSDT: "BNB / Tether",
  AVAXUSDT: "Avalanche / Tether"
};

function formatPair(pair) {
  return pair.replace("USDT", "/USDT");
}

function formatPrice(price) {
  return `$${Number(price).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

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

function calculateEMA(candles, period = 50) {
  const closes = candles.map(candle => candle.close);
  const multiplier = 2 / (period + 1);

  let ema = closes[0];

  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * multiplier + ema * (1 - multiplier);
  }

  return ema;
}

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

function calculateVolumeStrength(candles) {
  const recentVolume = candles[candles.length - 1].volume;

  const averageVolume =
    candles.slice(-21, -1).reduce((sum, candle) => sum + candle.volume, 0) / 20;

  return recentVolume > averageVolume ? "Strong" : "Weak";
}

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

function detectTrend(candles) {
  const lastClose = candles[candles.length - 1].close;
  const ema50 = calculateEMA(candles, 50);
  const ema200 = calculateEMA(candles, 100);

  if (lastClose > ema50 && ema50 > ema200) {
    return "Bullish";
  }

  if (lastClose < ema50 && ema50 < ema200) {
    return "Bearish";
  }

  return "Neutral";
}

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

function updateDashboard(signal, pair) {
  document.getElementById("pairTitle").textContent = formatPair(pair);
  document.getElementById("pairSubtitle").textContent = `${pairNames[pair] || formatPair(pair)} · 4h · Binance`;
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

async function scanMarket() {
  const table = document.getElementById("scannerTable");
  table.innerHTML = "";

  let best = {
    pair: "BTCUSDT",
    score: 0
  };

  for (const pair of pairs) {
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

function handleSearch() {
  const searchValue = document.getElementById("searchInput").value.trim().toUpperCase();

  if (!searchValue) return;

  const normalizedPair = searchValue.endsWith("USDT")
    ? searchValue.replace("/", "")
    : `${searchValue.replace("/", "")}USDT`;

  if (!pairs.includes(normalizedPair)) {
    alert("This demo currently supports BTC, ETH, SOL, BNB, and AVAX against USDT.");
    return;
  }

  loadMainChart(normalizedPair);
}

document.getElementById("refreshBtn").addEventListener("click", () => loadMainChart(selectedPair));
document.getElementById("searchInput").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    handleSearch();
  }
});
document.getElementById("scanBtn").addEventListener("click", scanMarket);
document.getElementById("riskBtn").addEventListener("click", calculateRisk);

createChart();
loadMainChart();
scanMarket();
calculateRisk();
