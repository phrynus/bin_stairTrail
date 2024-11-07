import axios, { type AxiosRequestConfig } from "axios";
import crypto from "crypto";
import { HttpsProxyAgent } from "https-proxy-agent";
import https from "https";

export class BinanceApi {
  axios: any;
  key: string;
  secret: string;
  resend: number;
  httpsAgent: any;
  constructor(key: string, secret: string, proxy: string) {
    this.httpsAgent = new HttpsProxyAgent(proxy);
    this.axios = axios.create({
      baseURL: "https://fapi.binance.com",
      httpsAgent: proxy == "" ? new https.Agent({ keepAlive: true }) : this.httpsAgent
    });
    // KEY密钥
    this.key = key;
    this.secret = secret;
    this.resend = 9;
    const _this = this;
    this.axios.interceptors.request.use((config: any) => {
      if (!config.params) config.params = {};
      config.params.timestamp = new Date().getTime();
      const serialisedParams = Object.entries(config.params)
        .map(([key, value]) => `${key}=${value}`)
        .join("&");
      const signature = crypto.createHmac("sha256", _this.secret).update(serialisedParams).digest("hex");
      config.url = `${config.url}?${serialisedParams}&signature=${signature}`;
      config.headers = {
        "X-MBX-APIKEY": _this.key
      };
      config.params = undefined;
      return config;
    });
    this.axios.interceptors.response.use(
      (response: any) => {
        return response.data;
      },
      (error: any) => {
        return Promise.reject(error);
      }
    );
  }
  _(options: AxiosRequestConfig, resend = false) {
    let i = 0;
    return this.axios(options).catch((error: any) => {
      if (resend && error.response.status === 400) {
        if (i < this.resend) {
          i++;
          return this.axios(options);
        }
      }
      return Promise.reject(error);
    });
  }
}
