"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const MEROSS_SECRET = "23x17ahWarFH6w29";
const MEROSS_APP_TYPE = "MerossIOT";
const MEROSS_APP_VERSION = "0.4.10.4";
const MEROSS_USER_AGENT = "MerossIOT/0.4.10.4";

let cachedSessionPath;

function getSessionPath() {
  if (cachedSessionPath) {
    return cachedSessionPath;
  }

  const candidateDirs = [
    process.env.NODE_RED_HOME,
    process.env.NODE_RED_DATA_DIR,
    process.env.HOME ? path.join(process.env.HOME, ".node-red") : null,
    "/home/pi/.node-red"
  ].filter(Boolean);

  for (const dir of candidateDirs) {
    const sessionPath = path.join(dir, "meross-sessions.json");
    if (fs.existsSync(sessionPath)) {
      cachedSessionPath = sessionPath;
      return cachedSessionPath;
    }
  }

  for (const dir of candidateDirs) {
    try {
      fs.accessSync(dir, fs.constants.W_OK);
      cachedSessionPath = path.join(dir, "meross-sessions.json");
      return cachedSessionPath;
    } catch {
      // Try next candidate
    }
  }

  const homeDir = process.env.HOME || os.homedir() || "/root";
  cachedSessionPath = path.join(homeDir, ".meross-sessions.json");
  return cachedSessionPath;
}

function ensureSessionPath(sessionPath) {
  const dir = path.dirname(sessionPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function cleanPayload(payload) {
  return Object.fromEntries(Object.entries(payload || {}).filter(([, value]) => value !== undefined && value !== ""));
}

function encodeParams(parameters) {
  return Buffer.from(JSON.stringify(parameters), "utf8").toString("base64");
}

function generateNonce(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function generateMessageId() {
  const randomstring = generateNonce(16);
  return crypto.createHash("md5").update(randomstring, "utf8").digest("hex").toLowerCase();
}

async function requestJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  if (!res.ok) {
    const message = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${message}`);
  }
  return data;
}

class MerossClient {
  constructor(options = {}) {
    this.email = options.email;
    this.password = options.password;
    this.baseUrl = options.baseUrl || "https://iotx-eu.meross.com";
    this.loginPath = options.loginPath || "/v1/Auth/signIn";
    this.countryCode = options.countryCode || "DE";
    this.locale = options.locale || "de_DE";
    this.mfaCode = options.mfaCode || "";
    this.session = null;
    this.loadSession();
  }

  getSessionKey() {
    // Create a unique key for this user's session
    return crypto.createHash("md5").update(this.email || "", "utf8").digest("hex").substring(0, 12);
  }

  loadSession() {
    if (!this.email) return;
    try {
      const sessionPath = getSessionPath();
      if (!fs.existsSync(sessionPath)) return;
      const data = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
      const key = this.getSessionKey();
      if (data.sessions && data.sessions[key]) {
        const saved = data.sessions[key];
        // Validate session is not expired (default 24h)
        const maxAge = (saved.maxAge || 24) * 60 * 60 * 1000;
        const age = Date.now() - new Date(saved.loggedInAt).getTime();
        if (age < maxAge) {
          this.session = {
            token: saved.token,
            key: saved.key,
            domain: saved.domain,
            mqttDomain: saved.mqttDomain,
            loggedInAt: saved.loggedInAt,
            loginUrl: saved.loginUrl
          };
          this.baseUrl = saved.domain || this.baseUrl;
          console.log(`[Meross] Loaded cached session for ${this.email}`);
        } else {
          console.log(`[Meross] Session expired (age: ${Math.round(age / 3600000)}h)`);
        }
      }
    } catch (err) {
      // Silently ignore errors
    }
  }

  saveSession() {
    if (!this.session || !this.email) return;
    try {
      const sessionPath = getSessionPath();
      ensureSessionPath(sessionPath);
      let data = { sessions: {} };
      try {
        if (fs.existsSync(sessionPath)) {
          data = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
        }
      } catch {
        // Start fresh if file doesn't exist or is invalid
      }
      const key = this.getSessionKey();
      data.sessions[key] = {
        email: this.email,
        token: this.session.token,
        key: this.session.key,
        domain: this.session.domain,
        mqttDomain: this.session.mqttDomain,
        loggedInAt: this.session.loggedInAt,
        loginUrl: this.session.loginUrl,
        maxAge: 24 // 24 hours default
      };
      fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2));
      console.log(`[Meross] Session cached for ${this.email}`);
    } catch (err) {
      console.error(`[Meross] Failed to save session: ${err.message}`);
    }
  }

  clearSession() {
    if (!this.email) return;
    try {
      const sessionPath = getSessionPath();
      if (!fs.existsSync(sessionPath)) return;
      const data = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
      const key = this.getSessionKey();
      delete data.sessions[key];
      fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2));
      this.session = null;
      console.log(`[Meross] Session cleared for ${this.email}`);
    } catch (err) {
      console.error(`[Meross] Failed to clear session: ${err.message}`);
    }
  }

  hashedPassword() {
    return crypto.createHash("md5").update(this.password, "utf8").digest("hex");
  }

  getLoginCandidates() {
    const candidates = [];
    const seen = new Set();
    const push = (baseUrl, loginPath) => {
      const key = `${baseUrl}${loginPath}`;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push({ baseUrl, loginPath });
      }
    };

    push(this.baseUrl, this.loginPath);
    push(this.baseUrl, "/v1/Auth/Login");
    push(this.baseUrl, "/v1/Auth/signIn");

    const altBaseUrls = [
      "https://iotx-eu.meross.com",
      "https://iotx-us.meross.com",
      "https://iotx-ap.meross.com",
      "https://iot.meross.com"
    ];
    for (const baseUrl of altBaseUrls) {
      push(baseUrl, "/v1/Auth/signIn");
      push(baseUrl, "/v1/Auth/Login");
    }

    return candidates;
  }

  async login() {
    // Only include mfaCode if it's not empty
    const mfaPayload = this.mfaCode ? { mfaCode: this.mfaCode } : {};
    
    const payloads = [
      cleanPayload({
        email: this.email,
        password: this.hashedPassword(),
        account: this.email,
        accountCountryCode: this.countryCode.toLowerCase(),
        encryption: 1,
        agree: 0,
        mobileInfo: {
          deviceModel: process.platform,
          mobileOsVersion: process.version,
          mobileOs: process.platform,
          uuid: "node-red-contrib-meross-mst100-200",
          carrier: ""
        },
        locale: this.locale,
        ...mfaPayload
      }),
      cleanPayload({
        email: this.email,
        password: this.hashedPassword(),
        accountCountryCode: this.countryCode.toLowerCase(),
        encryption: 1,
        agree: 0,
        mobileInfo: {
          deviceModel: process.platform,
          mobileOsVersion: process.version,
          mobileOs: process.platform,
          uuid: "node-red-contrib-meross-mst100-200",
          carrier: ""
        },
        ...mfaPayload
      })
    ];

    let lastError;
    for (const candidate of this.getLoginCandidates()) {
      const url = new URL(candidate.loginPath, candidate.baseUrl).toString();
      for (const payload of payloads) {
        try {
          const signed = this.signPayload(payload);
          const data = await requestJson(url, {
            method: "POST",
            headers: {
              Authorization: "Basic",
              AppVersion: MEROSS_APP_VERSION,
              AppType: MEROSS_APP_TYPE,
              AppLanguage: "EN",
              vender: "meross",
              "content-type": "application/json",
              "user-agent": MEROSS_USER_AGENT
            },
            body: JSON.stringify(signed),
            signal: AbortSignal.timeout(15000)
          });
          
          // Check for MFA requirement
          if (data.apiStatus === 1032 || data.apiStatus === 1033 || data.info?.includes("MFA") || data.info?.includes("Wrong")) {
            throw new Error("MFA authentication required. Please enter your 6-digit MFA code.");
          }
          if (data.apiStatus === 1011) {
            throw new Error("Invalid credentials. Please check your email and password.");
          }
          
          const result = data.data || data.result || data;
          const token = result.token || result.accessToken || result.access_token;
          const key = result.key || result.secret || result.mqttPassword;
          if (!token && !key) {
            throw new Error(`Meross login response did not include token/key fields: ${JSON.stringify(data)}`);
          }
          this.baseUrl = result.domain || candidate.baseUrl;
          this.loginPath = candidate.loginPath;
          this.session = {
            token,
            key,
            domain: result.domain || candidate.baseUrl,
            mqttDomain: result.mqttDomain,
            raw: data,
            loggedInAt: new Date().toISOString(),
            loginUrl: url
          };
          this.saveSession();
          return this.session;
        } catch (err) {
          if (String(err.message || "").includes("404 Not Found")) {
            continue;
          }
          lastError = err;
        }
      }
    }
    throw lastError;
  }

  signPayload(payload) {
    const params = encodeParams(payload);
    const timestamp = Date.now();
    const nonce = generateNonce(16);
    const sign = crypto
      .createHash("md5")
      .update(`${MEROSS_SECRET}${timestamp}${nonce}${params}`, "utf8")
      .digest("hex");
    return {
      params,
      sign,
      timestamp,
      nonce
    };
  }

  async request(method, path, body) {
    if (!this.session) {
      await this.login();
    }
    const headers = {
      "content-type": "application/json",
      "user-agent": "node-red-contrib-meross-mst100-200/0.1.0"
    };
    const url = new URL(path, this.baseUrl).toString();
    const upperMethod = String(method || "POST").toUpperCase();
    const requestOptions = {
      method: upperMethod,
      url,
      headers: {
        ...headers,
        Authorization: `Basic ${this.session.token || ""}`,
        AppVersion: MEROSS_APP_VERSION,
        AppType: MEROSS_APP_TYPE,
        AppLanguage: "EN",
        vender: "meross"
      },
      signal: AbortSignal.timeout(15000)
    };
    if (upperMethod !== "GET" && upperMethod !== "HEAD") {
      requestOptions.body = JSON.stringify(this.signPayload(body || {}));
    }
    return requestJson(url, requestOptions);
  }

  buildDeviceMessage(method, namespace, payload, destinationDeviceUuid) {
    const messageId = generateMessageId();
    const timestamp = Math.round(Date.now() / 1000);
    const signature = crypto
      .createHash("md5")
      .update(`${messageId}${this.session.key}${timestamp}`, "utf8")
      .digest("hex")
      .toLowerCase();
    return {
      messageId,
      timestamp,
      message: {
        header: {
          from: "http://localhost/config",
          messageId,
          method,
          namespace,
          payloadVersion: 1,
          sign: signature,
          timestamp,
          triggerSrc: "Android",
          uuid: destinationDeviceUuid
        },
        payload
      }
    };
  }

  async sendHubRequest({ hubId, hubHost, namespace, method, payload }) {
    if (!this.session) {
      await this.login();
    }
    try {
      const message = this.buildDeviceMessage(method, namespace, payload, hubId).message;
      const res = await fetch(`http://${hubHost}/config`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(15000)
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
      }
      return data.payload || data.data || data;
    } catch (err) {
      throw new Error(`Failed to reach hub at http://${hubHost}/config: ${err.message}`);
    }
  }

  async sendHubWaterRequest({ hubId, hubHost, method, payload }) {
    return this.sendHubRequest({
      hubId,
      hubHost,
      namespace: "Appliance.Control.Water",
      method,
      payload
    });
  }

  async sendHubToggleXRequest({ hubId, hubHost, method, payload }) {
    return this.sendHubRequest({
      hubId,
      hubHost,
      namespace: "Appliance.Hub.ToggleX",
      method,
      payload
    });
  }

  async sendHubToggleXStatus({ hubId, subDeviceId, hubHost }) {
    if (!subDeviceId) {
      throw new Error("Missing subDeviceId");
    }
    return this.sendHubToggleXRequest({
      hubId,
      hubHost,
      method: "GET",
      payload: {
        togglex: [{ id: subDeviceId }]
      }
    });
  }

  async sendHubToggleXSet({ hubId, subDeviceId, hubHost, onoff }) {
    if (!subDeviceId) {
      throw new Error("Missing subDeviceId");
    }
    return this.sendHubToggleXRequest({
      hubId,
      hubHost,
      method: "SET",
      payload: {
        togglex: [{ id: subDeviceId, onoff: onoff ? 1 : 0 }]
      }
    });
  }

  async sendHubWaterStatus({ hubId, subDeviceId, hubHost, channel, mst200 }) {
    if (!subDeviceId) {
      throw new Error("Missing subDeviceId");
    }
    const hasChannel = channel !== undefined && channel !== null && channel !== "";
    const control = mst200
      ? {
          subId: subDeviceId,
          channels: hasChannel ? [Number(channel)] : []
        }
      : { subId: subDeviceId };
    if (!mst200 && hasChannel) {
      control.channel = Number(channel);
    }
    return this.sendHubWaterRequest({
      hubId,
      hubHost,
      method: "GET",
      payload: {
        control: [control]
      }
    });
  }

  async sendHubWaterSet({ hubId, subDeviceId, hubHost, channel, mst200, onoff, duration }) {
    if (!subDeviceId) {
      throw new Error("Missing subDeviceId");
    }
    const durationValue =
      duration !== undefined && duration !== null && duration !== "" ? Number(duration) : undefined;
    const control = mst200
      ? {
          subId: subDeviceId,
          channels: [Number(channel || 1)],
          onoff: onoff ? 1 : 2,
          ...(durationValue !== undefined ? { dura: durationValue } : {})
        }
      : {
          subId: subDeviceId,
          channel: Number(channel ?? 0),
          onoff: onoff ? 1 : 2
        };
    if (!mst200 && durationValue !== undefined) {
      control.dura = durationValue;
    }
    return this.sendHubWaterRequest({
      hubId,
      hubHost,
      method: "SET",
      payload: {
        control: [control]
      }
    });
  }

  // Get list of all devices from the Meross cloud
  async getDevices() {
    const response = await this.request("POST", "/v1/Device/devList", {});
    return response;
  }

  // Get device status
  async getDeviceStatus(deviceId) {
    const response = await this.request("POST", "/v1/Device/Status", {
      payload: {
        deviceId
      }
    });
    return response;
  }

}

module.exports = { MerossClient };
