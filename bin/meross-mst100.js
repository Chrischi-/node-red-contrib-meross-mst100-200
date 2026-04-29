#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const readline = require("readline");
const { MerossClient } = require("../lib/meross-client");

function parseArgs(argv) {
  const args = {
    command: "status",
    channel: 0,
    baseUrl: "https://iotx-eu.meross.com",
    loginPath: "/v1/Auth/signIn",
    countryCode: "us",
    locale: "de_DE"
  };

  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--email") args.email = argv[++i];
    else if (value === "--password") args.password = argv[++i];
    else if (value === "--base-url") args.baseUrl = argv[++i];
    else if (value === "--login-path") args.loginPath = argv[++i];
    else if (value === "--device-id") args.deviceId = argv[++i];
    else if (value === "--hub-id") args.hubId = argv[++i];
    else if (value === "--hub-host") args.hubHost = argv[++i];
    else if (value === "--sub-device-id") args.subDeviceId = argv[++i];
    else if (value === "--channel") args.channel = Number(argv[++i] || 0);
    else if (value === "--command") args.command = argv[++i];
    else if (value === "--onoff") args.onoff = argv[++i] !== "false";
    else if (value === "--duration") args.duration = Number(argv[++i]);
    else if (value === "--payload") args.payload = JSON.parse(argv[++i]);
    else if (value === "--method") args.method = argv[++i];
    else if (value === "--path") args.path = argv[++i];
    else if (value === "--mfa") args.mfaCode = argv[++i];
    else if (value === "--country") args.countryCode = argv[++i];
    else if (value === "--locale") args.locale = argv[++i];
    else if (value === "--config") args.config = argv[++i];
    else if (value === "--mst200") args.mst200 = true;
    else if (value === "--help" || value === "-h") args.help = true;
  }

  return args;
}

function loadConfig(file) {
  if (!file) return {};
  const resolved = path.resolve(process.cwd(), file);
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function ask(question, silent = false) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });

  return new Promise((resolve) => {
    if (silent) {
      rl.stdoutMuted = true;
      rl.question(question, (answer) => {
        rl.close();
        process.stdout.write("\n");
        resolve(answer);
      });
      rl._writeToOutput = function _writeToOutput(stringToWrite) {
        if (rl.stdoutMuted) {
          rl.output.write("*");
        } else {
          rl.output.write(stringToWrite);
        }
      };
      return;
    }

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.email || !args.password) {
    console.log([
      "Usage:",
      "  meross-mst100 --email you@example.com --password secret --device-id DEVICE_ID [options]",
      "",
      "Options:",
      "  --command status|switch|listDevices|listSubDevices|subStatus|subSwitch|rawRequest",
      "  --channel 0",
      "  --hub-id HUB_UUID",
      "  --hub-host 192.168.1.55",
      "  --sub-device-id MST100_OR_MST200_SUB_ID",
      "  --payload '{\"...\":true}'",
      "  --method POST",
      "  --path /v1/Device/Status",
      "  --base-url https://iotx-eu.meross.com",
      "  --login-path /v1/Auth/signIn",
      "  --mfa 123456",
      "  --config meross.json",
      "  --mst200    Use MST200 mode"
    ].join("\n"));
    process.exit(args.help ? 0 : 1);
  }

  const config = { ...loadConfig(args.config), ...args };
  const client = new MerossClient(config);
  
  // Only ask for MFA if we don't have a valid session
  let session = client.session;
  if (!session) {
    if (!config.mfaCode) {
      const needsMfa = await ask("MFA code (leave empty if not needed): ");
      if (needsMfa) config.mfaCode = needsMfa.trim();
    }
    // Re-create client with MFA code if needed
    if (config.mfaCode && !client.mfaCode) {
      client.mfaCode = config.mfaCode;
    }
  }
  
  // Login if no valid session
  if (!session) {
    try {
      session = await client.login();
    } catch (err) {
      console.error("Login failed. Tried these endpoints:");
      for (const candidate of client.getLoginCandidates()) {
        console.error(`- ${candidate.baseUrl}${candidate.loginPath}`);
      }
      throw err;
    }
  } else {
    console.log("[Meross] Using cached session (no login needed)");
    console.log(JSON.stringify({ loggedInAt: session.loggedInAt, hasToken: !!session.token, hasKey: !!session.key, loginUrl: session.loginUrl }, null, 2));
  }

  if (config.command === "listDevices") {
    try {
      const result = await client.request("POST", "/v1/Device/devList", {});
      console.log(JSON.stringify(result, null, 2));
      return;
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      if (!message.includes("Invalid parameter")) {
        throw err;
      }
      const py = [
        "import asyncio, json, os, sys",
        "from meross_iot.http_api import MerossHttpClient",
        "async def main():",
        "  client = await MerossHttpClient.async_from_user_password(",
        "    api_base_url=os.environ['MEROSS_API_BASE_URL'],",
        "    email=os.environ['MEROSS_EMAIL'],",
        "    password=os.environ['MEROSS_PASSWORD'],",
        "    mfa_code=os.environ.get('MEROSS_MFA_CODE') or None",
        "  )",
        "  data = await client.async_list_devices()",
        "  print(json.dumps([x.to_dict() if hasattr(x, 'to_dict') else x.__dict__ for x in data], indent=2))",
        "  client.close()",
        "asyncio.run(main())"
      ].join("\n");
      const env = {
        ...process.env,
        MEROSS_API_BASE_URL: client.baseUrl,
        MEROSS_EMAIL: config.email,
        MEROSS_PASSWORD: config.password,
        MEROSS_MFA_CODE: config.mfaCode || ""
      };
      const output = execFileSync("python3", ["-c", py], { env, encoding: "utf8" });
      process.stdout.write(output);
      return;
    }
  }

  if (config.command === "listSubDevices") {
    if (!config.hubId) {
      throw new Error("Missing --hub-id");
    }
    const result = await client.request("POST", "/v1/Hub/getSubDevices", { uuid: config.hubId });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (config.command === "subStatus" || config.command === "subSwitch") {
    if (!config.hubId) throw new Error("Missing --hub-id");
    if (!config.subDeviceId) throw new Error("Missing --sub-device-id");
    if (!config.hubHost) throw new Error("Missing --hub-host");
    const isMst200ChannelCommand =
      config.mst200 &&
      (config.command === "subSwitch" || config.command === "subStatus") &&
      Number.isInteger(config.channel) &&
      config.channel >= 1 &&
      config.channel <= 2;
    
    const result =
      isMst200ChannelCommand
        ? config.command === "subStatus"
          ? await client.sendHubWaterStatus({
              hubId: config.hubId,
              hubHost: config.hubHost,
              subDeviceId: config.subDeviceId,
              channel: config.channel,
              mst200: true
            })
          : await client.sendHubWaterSet({
              hubId: config.hubId,
              hubHost: config.hubHost,
              subDeviceId: config.subDeviceId,
              channel: config.channel,
              mst200: true,
              onoff: config.onoff,
              duration: config.duration
            })
        : config.mst200
        ? config.command === "subStatus"
          ? await client.sendHubToggleXStatus({
              hubId: config.hubId,
              hubHost: config.hubHost,
              subDeviceId: config.subDeviceId
            })
          : await client.sendHubToggleXSet({
              hubId: config.hubId,
              hubHost: config.hubHost,
              subDeviceId: config.subDeviceId,
              onoff: config.onoff
            })
        : config.command === "subStatus"
          ? await client.sendHubWaterStatus({
              hubId: config.hubId,
              hubHost: config.hubHost,
              subDeviceId: config.subDeviceId,
              channel: config.channel,
              mst200: config.mst200
            })
          : await client.sendHubWaterSet({
              hubId: config.hubId,
              hubHost: config.hubHost,
              subDeviceId: config.subDeviceId,
              channel: config.channel,
              mst200: config.mst200,
              onoff: config.onoff,
              duration: config.duration
            });
    if (config.mst200 && !isMst200ChannelCommand && config.command === "subStatus") {
      const toggle = result && Array.isArray(result.togglex) ? result.togglex[0] : undefined;
      console.log(JSON.stringify({
        subDeviceId: config.subDeviceId,
        onoff: toggle ? toggle.onoff : undefined,
        isOn: toggle ? toggle.onoff === 1 : undefined
      }, null, 2));
      return;
    }
    if (config.mst200 && isMst200ChannelCommand && config.command === "subStatus") {
      const control = result && Array.isArray(result.control) ? result.control[0] : undefined;
      console.log(JSON.stringify({
        subDeviceId: config.subDeviceId,
        channel: config.channel,
        channels: control ? control.channels : undefined
      }, null, 2));
      return;
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!config.deviceId && config.command !== "rawRequest") {
    throw new Error("Missing --device-id");
  }

  const payloads = {
    status: {
      deviceId: config.deviceId,
      channel: config.channel
    },
    switch: {
      deviceId: config.deviceId,
      channel: config.channel,
      onoff: config.onoff ? 1 : 0
    },
    rawRequest: config.payload || {}
  };

  const pathName = config.path || {
    status: "/v1/Device/Status",
    switch: "/v1/Device/Switch",
    rawRequest: "/v1/Device/Status"
  }[config.command];

  const method = config.method || (config.command === "listDevices" ? "GET" : "POST");
  const finalMethod = config.command === "listDevices" ? "POST" : method;
  const result = await client.request(finalMethod, pathName, payloads[config.command]);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
