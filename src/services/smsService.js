"use strict";
const { config } = require("../config/env");

let _sms = null;

function getSMSClient() {
  if (_sms) return _sms;
  if (!config.at.apiKey) return null;
  try {
    const AfricasTalking = require("africastalking");
    const at = AfricasTalking({ apiKey: config.at.apiKey, username: config.at.username });
    _sms = at.SMS;
    return _sms;
  } catch {
    return null;
  }
}

/**
 * Send an SMS via Africa's Talking.
 * In dev mode (no AT_API_KEY set) the message is logged to console and the
 * function returns { sent: false, dev: true, message } so callers can surface
 * the content in API responses for local testing.
 *
 * @param {string|string[]} to   - E.164 phone number(s), e.g. "+254712345678"
 * @param {string}          body - Message text
 * @returns {Promise<{ sent: boolean, dev?: boolean, message?: string, result?: object }>}
 */
async function sendSMS(to, body) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (recipients.length === 0) return { sent: false, reason: "no_recipients" };

  if (!config.at.apiKey) {
    console.log(`[SMS DEV] → ${recipients.join(", ")}`);
    console.log(`[SMS DEV]   ${body}`);
    return { sent: false, dev: true, message: body, recipients };
  }

  const client = getSMSClient();
  if (!client) return { sent: false, reason: "client_unavailable" };

  try {
    const result = await client.send({
      to: recipients,
      message: body,
      ...(config.at.senderId ? { from: config.at.senderId } : {}),
    });
    return { sent: true, result };
  } catch (err) {
    console.error("[SMS] Send failed:", err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendSMS };
