"use strict";

// Pesapal v3 API service
// Docs: https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/api-reference
//
// Required env vars:
//   PESAPAL_CONSUMER_KEY     — from Pesapal dashboard
//   PESAPAL_CONSUMER_SECRET  — from Pesapal dashboard
//   PESAPAL_ENV              — "sandbox" (default) | "production"
//   PESAPAL_IPN_URL          — publicly reachable URL e.g. https://api.yourdomain.com/api/v1/biz/payments/ipn
//   PESAPAL_CALLBACK_URL     — frontend URL Pesapal redirects to after card payment

const SANDBOX_URL = "https://cybqa.pesapal.com/pesapalv3";
const PROD_URL    = "https://pay.pesapal.com/v3";

// In-process cache for auth token and registered IPN ID
let _cachedToken     = null;
let _tokenExpiry     = 0;
let _cachedIpnId     = null;

function baseUrl() {
  return process.env.PESAPAL_ENV === "production" ? PROD_URL : SANDBOX_URL;
}

async function pesapalFetch(path, options = {}) {
  const url = `${baseUrl()}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Accept":       "application/json",
      ...(options.headers ?? {}),
    },
  });

  let body;
  try { body = await response.json(); }
  catch { body = {}; }

  if (!response.ok) {
    const msg = body?.error?.message || body?.message || `Pesapal API error ${response.status}`;
    throw new Error(msg);
  }
  return body;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getAuthToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

  const consumerKey    = process.env.PESAPAL_CONSUMER_KEY    || "PESAPAL_CONSUMER_KEY_NOT_SET";
  const consumerSecret = process.env.PESAPAL_CONSUMER_SECRET || "PESAPAL_CONSUMER_SECRET_NOT_SET";

  const data = await pesapalFetch("/api/Auth/RequestToken", {
    method: "POST",
    body: JSON.stringify({ consumer_key: consumerKey, consumer_secret: consumerSecret }),
  });

  _cachedToken = data.token;
  _tokenExpiry = Date.now() + 4 * 60 * 1000; // cache for 4 minutes (tokens last 5)
  return _cachedToken;
}

async function authHeaders() {
  const token = await getAuthToken();
  return { Authorization: `Bearer ${token}` };
}

// ── IPN Registration ──────────────────────────────────────────────────────────
// Registers once and caches the IPN ID for the process lifetime.

async function getIpnId() {
  if (_cachedIpnId) return _cachedIpnId;

  const ipnUrl = process.env.PESAPAL_IPN_URL || "http://localhost:5000/api/v1/biz/payments/ipn";
  const headers = await authHeaders();

  const data = await pesapalFetch("/api/URLSetup/RegisterIPN", {
    method: "POST",
    headers,
    body: JSON.stringify({ url: ipnUrl, ipn_notification_type: "POST" }),
  });

  _cachedIpnId = data.ipn_id;
  return _cachedIpnId;
}

// ── Submit Order ──────────────────────────────────────────────────────────────

/**
 * Creates a Pesapal payment order.
 * @param {object} opts
 * @param {string} opts.merchantRef     — unique order reference (use saleRef)
 * @param {number} opts.amount          — total amount in KES
 * @param {string} opts.currency        — default "KES"
 * @param {string} opts.description     — shown to customer
 * @param {string} [opts.phone]         — customer phone (required for M-Pesa STK)
 * @param {string} [opts.email]         — customer email (optional)
 * @returns {{ order_tracking_id, redirect_url, merchant_reference, status }}
 */
async function submitOrder({ merchantRef, amount, currency = "KES", description, phone, email }) {
  const [headers, ipnId] = await Promise.all([authHeaders(), getIpnId()]);

  const callbackUrl = process.env.PESAPAL_CALLBACK_URL
    ? `${process.env.PESAPAL_CALLBACK_URL}?ref=${encodeURIComponent(merchantRef)}`
    : `http://localhost:8080/payment-complete?ref=${encodeURIComponent(merchantRef)}`;

  const body = {
    id:            merchantRef,
    currency,
    amount,
    description,
    callback_url:  callbackUrl,
    redirect_mode: "PARENT_WINDOW",
    notification_id: ipnId,
    billing_address: {
      phone_number:  phone  || "",
      email_address: email  || "",
      first_name:    "Customer",
      middle_name:   "",
      last_name:     "",
    },
  };

  return pesapalFetch("/api/Transactions/SubmitOrderRequest", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// ── Transaction Status ────────────────────────────────────────────────────────

/**
 * Returns the latest payment status for an order.
 * status_code: 1 = Completed, 0 = Invalid, 2 = Failed, 3 = Reversed
 */
async function getTransactionStatus(orderTrackingId) {
  const headers = await authHeaders();
  return pesapalFetch(
    `/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`,
    { headers },
  );
}

// ── Status helpers ────────────────────────────────────────────────────────────

function statusCodeToString(code) {
  return ({ 1: "Completed", 0: "Invalid", 2: "Failed", 3: "Reversed" })[code] ?? "Pending";
}

function isCompleted(code)  { return code === 1; }
function isFailed(code)     { return code === 0 || code === 2 || code === 3; }

module.exports = {
  submitOrder,
  getTransactionStatus,
  getAuthToken,
  statusCodeToString,
  isCompleted,
  isFailed,
};
