import { pro } from "ccxt";
import logUpdate from "log-update";
import { table } from "table";
import dayjs from "dayjs";
import { file } from "bun";
import { BinanceApi } from "binanceApi";
import log4js from "log4js";

console.log(dayjs().format("YYYY MM-DD HH:mm:ss SSS"), `  v${Bun.version}`, "\n");

log4js.configure({
  appenders: {
    hourlyFile: {
      type: "file",
      filename: `./logs/${new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().split("T")[0]}.log`, // 日志文件名中包含日期
      pattern: "yyyy-MM-ddTHH", // 按小时分割
      compress: true // 压缩日志
      // layout: {
      //   type: "pattern",
      //   pattern: "[%d{yyyy-MM-dd hh:mm:ss}] [%p]: %m%n" // 日志格式
      // }
    }
  },
  categories: {
    default: { appenders: ["hourlyFile"], level: "info" } // 只使用文件输出
  }
});

var logger = log4js.getLogger();

let config = await file("config.json", { type: "application/json" }).json();

if (!config.STOPLOSS) throw "STOPLOSS is required";
console.log("止损：", config.STOPLOSS);
if (!config.STOPLOSSSTAIRS) throw "STOPLOSSSTAIRS is required";
console.log("回撤止损：", config.STOPLOSSSTAIRS.map((item: any) => `${item[0]} -> ${item[1]}`).join(" | "));
if (!config.APIKEY) throw "APIKEY is required";
if (!config.SECRET) throw "SECRET is required";
// bun build --compile --minify --sourcemap ./main.ts --outfile main

const stopLoss = Number(config.STOPLOSS); // 止损

const gear: any = config.STOPLOSSSTAIRS;

const exchange = new pro.binance({
  apiKey: config.APIKEY,
  secret: config.SECRET,
  // timeout: 3000,
  // rateLimit: 50,
  options: {
    defaultType: "future"
  }
});
const BinanceExchange = new BinanceApi(config.APIKEY, config.SECRET, config.PROXYSHTTP);
if (config.PROXYSHTTP) {
  exchange.httpProxy = config.PROXYSHTTP;
}
// exchange.setSandboxMode(true); // 沙盒模式
exchange.markets = await exchange.loadMarkets(true).catch((e) => {
  console.error("loadMarkets error", e);
  throw e;
});

const pond: any = {};

const log = () => {
  let time = dayjs().format("YYYY-MM-DD HH:mm:ss SSS");
  let symbols = Object.keys(pond).map((item) => {
    let data = [
      pond[item].symbol, // 合约
      pond[item].contracts, // 持仓
      pond[item].entryPrice, // 开仓价格
      pond[item].side, // 方向
      pond[item].unrealizedPnl,
      pond[item].percentage,
      pond[item].topPercentage,
      pond[item].stopLoss,
      pond[item].markPrice,
      pond[item].t ? pond[item].t : "-"
    ];

    return data;
  });
  let symbolTab = table(
    [
      ["合约", "持仓数量", "开仓价格", "方向", "盈亏USDT", "浮动盈亏", "最高盈亏", "止盈位", "当前价格", "档位"],
      ...symbols
    ],
    {
      columns: [
        { alignment: "right" },
        { alignment: "right" },
        { alignment: "right" },
        { alignment: "right" },
        { alignment: "right" },
        { alignment: "right" },
        { alignment: "right" },
        { alignment: "right" },
        { alignment: "right" },
        { alignment: "right" }
      ],
      header: {
        alignment: "center",
        content: `${time} - 持仓数量 ${symbols.length}`
      }
    }
  );

  logUpdate(symbolTab);
};
// 监听config.json改变改变重新启动
let positions = await exchange.fetchPositionsWs();
console.log(positions);

while (true) {
  try {
    let positions = await exchange.fetchPositionsWs();
    let positionSsymbols = positions.map((item) => item.symbol);
    let pondSymbols = Object.keys(pond);
    for (let index = 0; index < pondSymbols.length; index++) {
      const item = pondSymbols[index];
      if (!positionSsymbols.includes(item)) {
        delete pond[item];
      }
    }
    if (config.DELAY) {
      await Bun.sleep(Number(config.DELAY));
    }
    for (let index = 0; index < positions.length; index++) {
      const item = positions[index];
      delete item.info;
      pond[item.symbol + item.side] = { ...pond[item.symbol + item.side], ...item };
      let percentage = ((item.markPrice - item.entryPrice) / item.entryPrice) * 100;
      if (item.side == "short") {
        percentage = -percentage;
      }
      pond[item.symbol + item.side].percentage = percentage.toFixed(4);
      pond[item.symbol + item.side].topPercentage =
        pond[item.symbol + item.side].topPercentage > percentage.toFixed(4)
          ? pond[item.symbol + item.side].topPercentage
          : percentage.toFixed(4);
      let pondStop = () => {
        let stop = stopLoss;
        let gears = gear;
        if (config.STOPSYMBOL[item.symbol + item.side]?.STOPLOSS) {
          stop = config.STOPSYMBOL[item.symbol + item.side].STOPLOSS;
        }
        if (config.STOPSYMBOL[item.symbol + item.side]?.STOPLOSSSTAIRS) {
          gears = config.STOPSYMBOL[item.symbol + item.side].STOPLOSSSTAIRS;
        }
        for (let index = 0; index < gears.length; index++) {
          if (pond[item.symbol + item.side].topPercentage >= gears[index][0]) {
            stop = pond[item.symbol + item.side].topPercentage * (1 - gears[index][1]);
            pond[item.symbol + item.side].t = [
              "I",
              "II",
              "III",
              "IV",
              "V",
              "VI",
              "VII",
              "VIII",
              "IX",
              "X",
              "XI",
              "XII",
              "XIII",
              "XIV",
              "XV",
              "XVI",
              "XVII",
              "XVIII",
              "XIX",
              "XX"
            ][index];
          }
        }
        return stop.toFixed(2);
      };
      pond[item.symbol + item.side].stopLoss = pondStop();
      //
      if (pond[item.symbol + item.side].stopLoss >= percentage) {
        logger.info("价格变化\n", JSON.stringify(pond[item.symbol + item.side]), "\n");
        BinanceExchange._({
          method: "POST",
          url: "/fapi/v1/order",
          params: {
            symbol: item.symbol.split("/")[0] + "USDT",
            type: "MARKET",
            timeInForce: "GTC",
            side: item.side == "long" ? "SELL" : "BUY",
            positionSide: item.side == "long" ? "SELL" : "BUY",
            quantity
          }
        });
        // await exchange
        //   .createOrder(item.symbol, "market", item.side == "long" ? "sell" : "buy", item.contracts, undefined, {
        //     test: true
        //   })
        //   .then((res: any) => {
        //     logger.info("平仓成功", pond[item.symbol + item.side], res);
        //     delete pond[item.symbol + item.side];
        //   })
        //   .catch((e: any) => {
        //     logger.error("平仓失败", e);
        //   });
      }
    }
    log();
  } catch (e) {
    console.log("while", e);
    logger.error(e);
  }
}
