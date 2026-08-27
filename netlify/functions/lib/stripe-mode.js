function getStripeSecretKey() {
  return String(process.env.STRIPE_SECRET_KEY || '').trim();
}

function isStripeTestMode(secret = getStripeSecretKey()) {
  return secret.startsWith('sk_test_');
}

module.exports = {
  getStripeSecretKey,
  isStripeTestMode,
};
