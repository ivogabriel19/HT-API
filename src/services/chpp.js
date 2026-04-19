import oauthPkg from 'oauth';
import { XMLParser } from 'fast-xml-parser';
import { config } from '../config/index.js';

const { OAuth } = oauthPkg;

const xmlParser = new XMLParser({ ignoreAttributes: false });

function createConsumer() {
  return new OAuth(
    config.chpp.requestTokenUrl,
    config.chpp.accessTokenUrl,
    config.chpp.consumerKey,
    config.chpp.consumerSecret,
    '1.0A',
    config.chpp.callbackUrl,
    'HMAC-SHA1',
  );
}

// ─── Step 1: Get a temporary request token ────────────────────────────────────
export function getRequestToken() {
  return new Promise((resolve, reject) => {
    createConsumer().getOAuthRequestToken((err, token, tokenSecret) => {
      if (err) return reject(new Error(err.data ?? err.message ?? JSON.stringify(err)));
      resolve({ oauthToken: token, oauthTokenSecret: tokenSecret });
    });
  });
}

// ─── Step 2: Build the authorization URL to redirect the user to ──────────────
export function buildAuthorizeUrl(oauthToken) {
  return `${config.chpp.authorizeUrl}?oauth_token=${oauthToken}`;
}

// ─── Step 3: Exchange verifier for a permanent access token ───────────────────
export function getAccessToken(oauthToken, oauthTokenSecret, oauthVerifier) {
  return new Promise((resolve, reject) => {
    createConsumer().getOAuthAccessToken(
      oauthToken, oauthTokenSecret, oauthVerifier,
      (err, accessToken, accessTokenSecret) => {
        if (err) return reject(new Error(err.data ?? err.message ?? JSON.stringify(err)));
        resolve({ accessToken, accessTokenSecret });
      },
    );
  });
}

// ─── Core: Make a signed CHPP API request ─────────────────────────────────────
export function chppRequest(accessToken, accessTokenSecret, params) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams(params).toString();
    const url = `${config.chpp.apiUrl}?${query}`;
    createConsumer().get(url, accessToken, accessTokenSecret, (err, data) => {
      if (err) return reject(new Error(err.data ?? err.message ?? JSON.stringify(err)));
      resolve(xmlParser.parse(data));
    });
  });
}
