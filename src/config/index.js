import 'dotenv/config';

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isDev: (process.env.NODE_ENV ?? 'development') === 'development',

  chpp: {
    consumerKey:    required('CHPP_CONSUMER_KEY'),
    consumerSecret: required('CHPP_CONSUMER_SECRET'),
    callbackUrl:    required('CHPP_CALLBACK_URL'),
    requestTokenUrl: 'https://chpp.hattrick.org/oauth/request_token.ashx',
    authorizeUrl:    'https://chpp.hattrick.org/oauth/authorize.aspx',
    accessTokenUrl:  'https://chpp.hattrick.org/oauth/access_token.ashx',
    apiUrl:          'https://chpp.hattrick.org/chppxml.ashx',
  },

  jwt: {
    secret:    required('JWT_SECRET'),
    expiresIn: '7d',
  },

  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',

  cache: {
    // CHPP data TTL in seconds (Hattrick updates team data ~once per day)
    teamTtl:  60 * 60 * 4,  // 4 hours
    matchTtl: 60 * 60 * 1,  // 1 hour
  },
};
