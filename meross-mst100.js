"use strict";

const path = require("path");
const { MerossClient } = require(path.join(__dirname, "lib", "meross-client"));

module.exports = function (RED) {
  function MerossCloudConfigNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.email = config.email;
    node.password = config.password;
    node.baseUrl = config.baseUrl || "https://iotx-eu.meross.com";
    node.loginPath = config.loginPath || "/v1/Auth/signIn";
    node.locale = config.locale || "de_DE";
    node.countryCode = config.countryCode || "us";
    node.mfaCode = config.mfaCode || "";
    node.client = new MerossClient(config);

    node.logIn = async function () {
      const session = await node.client.login();
      node.status({ fill: "green", shape: "dot", text: "logged in" });
      return session;
    };

    node.request = function (method, path, body) {
      return node.client.request(method, path, body);
    };

    node.on("close", function (done) {
      node.client.session = null;
      done();
    });
  }

  RED.nodes.registerType("meross cloud config", MerossCloudConfigNode);

  function MerossDeviceNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.name = config.name;
    node.deviceId = config.deviceId;
    node.channel = config.channel || 0;
    node.command = config.command || "rawRequest";
    node.path = config.path || "/v1/Device/Status";
    node.method = config.method || "POST";
    node.cloud = RED.nodes.getNode(config.cloud);
    node.hubId = config.hubId;
    node.hubHost = config.hubHost;
    node.subDeviceId = config.subDeviceId;
    node.onoff = config.onoff === true || config.onoff === "true";
    node.duration = config.duration || "";

    node.on("input", async function (msg, send, done) {
      send = send || function () { node.send.apply(node, arguments); };
      try {
        if (!node.cloud) {
          throw new Error("Missing Meross cloud config");
        }
        const deviceId = msg.deviceId || node.deviceId;
        const command = msg.command || node.command;
        let result;

        if (command === "listDevices") {
          result = await node.cloud.request("POST", "/v1/Device/devList", {});
        } else if (command === "listSubDevices") {
          result = await node.cloud.request("POST", "/v1/Hub/getSubDevices", {
            uuid: msg.hubId || node.hubId
          });
        } else if (command === "subStatus") {
          // Hub host is required
          let hubHost = msg.hubHost || node.hubHost;
          if (!hubHost) {
            throw new Error("hubHost is required for subStatus command");
          }
          const isMst200ChannelCommand =
            node.type === "meross mst200" &&
            Number.isInteger(Number(msg.channel ?? node.channel)) &&
            Number(msg.channel ?? node.channel) >= 1 &&
            Number(msg.channel ?? node.channel) <= 2;
          if (isMst200ChannelCommand) {
            result = await node.cloud.client.sendHubWaterStatus({
              hubId: msg.hubId || node.hubId,
              hubHost: hubHost,
              subDeviceId: msg.subDeviceId || node.subDeviceId,
              channel: msg.channel ?? node.channel,
              mst200: true
            });
          } else if (node.type === "meross mst200") {
            result = await node.cloud.client.sendHubToggleXStatus({
              hubId: msg.hubId || node.hubId,
              hubHost: hubHost,
              subDeviceId: msg.subDeviceId || node.subDeviceId
            });
          } else {
            result = await node.cloud.client.sendHubWaterStatus({
              hubId: msg.hubId || node.hubId,
              hubHost: hubHost,
              subDeviceId: msg.subDeviceId || node.subDeviceId,
              channel: msg.channel ?? node.channel
            });
          }
        } else if (command === "subSwitch") {
          // Hub host is required
          let hubHost = msg.hubHost || node.hubHost;
          if (!hubHost) {
            throw new Error("hubHost is required for subSwitch command");
          }
          const isMst200ChannelCommand =
            node.type === "meross mst200" &&
            Number.isInteger(Number(msg.channel ?? node.channel)) &&
            Number(msg.channel ?? node.channel) >= 1 &&
            Number(msg.channel ?? node.channel) <= 2;
          if (isMst200ChannelCommand) {
            result = await node.cloud.client.sendHubWaterSet({
              hubId: msg.hubId || node.hubId,
              hubHost: hubHost,
              subDeviceId: msg.subDeviceId || node.subDeviceId,
              channel: msg.channel ?? node.channel,
              mst200: true,
              onoff: msg.onoff ?? node.onoff,
              duration: msg.duration ?? node.duration
            });
          } else if (node.type === "meross mst200") {
            result = await node.cloud.client.sendHubToggleXSet({
              hubId: msg.hubId || node.hubId,
              hubHost: hubHost,
              subDeviceId: msg.subDeviceId || node.subDeviceId,
              onoff: msg.onoff ?? node.onoff
            });
          } else {
            result = await node.cloud.client.sendHubWaterSet({
              hubId: msg.hubId || node.hubId,
              hubHost: hubHost,
              subDeviceId: msg.subDeviceId || node.subDeviceId,
              channel: msg.channel ?? node.channel,
              onoff: msg.onoff ?? node.onoff,
              duration: msg.duration ?? node.duration
            });
          }
        } else if (command === "status") {
          result = await node.cloud.request("POST", "/v1/Device/Status", {
            deviceId,
            channel: msg.channel ?? node.channel
          });
        } else if (command === "switch" || command === "onoff") {
          result = await node.cloud.request("POST", "/v1/Device/Switch", {
            deviceId,
            channel: msg.channel ?? node.channel,
            onoff: msg.onoff ? 1 : 0
          });
        } else {
          const body = msg.payload !== undefined ? msg.payload : msg.body;
          result = await node.cloud.request(msg.method || node.method, msg.path || node.path, body);
        }

        msg.payload = result;
        msg.meross = {
          command,
          deviceId
        };
        send(msg);
        done();
      } catch (err) {
        done(err);
      }
    });
  }

  RED.nodes.registerType("meross mst100", MerossDeviceNode);
  RED.nodes.registerType("meross mst200", MerossDeviceNode);
};
