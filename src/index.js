/* eslint-disable new-cap */
/* eslint-disable max-classes-per-file */
/* eslint-disable class-methods-use-this */
const { Wallet } = require('ethers');
const localStorage = require('local-storage');
const crypto = require('crypto');
const aes = require('aes-js');

const Vault = require('./lib/vault');

const {
  WRONG_PASSWORD, INVALID_MNEMONIC, PASSWORD_MATCH_ERROR, PASSWORD_CHANGE_SUCCESS, DELETE_SUCCESS, LOGOUT_SUCCESS,
} = require('./constants/response');
const {
  getRequestWithAccessToken: getRequest,
  postRequestWithAccessToken,
  sendTransaction,
  encryptKey,
  decryptKey,
  _validatePassword,
  updatePasswordAndPrivateKey,
  extractPrivateKey,
  verifyPublicAddress,
  postRequestForLoginViaSafle,
  getAccessToken,
  deleteRequest,
  relayTransaction,
  getBaseUrl,
  generateEncryptionKey,
  _generatePDKeyHash,
} = require('./utils/helper');

let seeds;
let firstNumber;
let secondNumber;

async function encryptEncryptionKey(safleId, password) {
  const encryptionKey = await generateEncryptionKey();

  const passwordDerivedKey = crypto.pbkdf2Sync(safleId, password, 10000, 32, 'sha512');

  const aesCBC = new aes.ModeOfOperation.cbc(passwordDerivedKey);
  const encryptedEncryptionKey = aesCBC.encrypt(encryptionKey);

  return encryptedEncryptionKey;
}

async function hashPassword(safleId, password) {
  const passwordDerivedKey = crypto.pbkdf2Sync(safleId, password, 10000, 32, 'sha512');

  const passwordHash = crypto.pbkdf2Sync(passwordDerivedKey, password, 10000, 32, 'sha512');
  const passwordHashHex = passwordHash.toString('hex');

  return passwordHashHex;
}

async function generatePDKeyHash(safleId, password) {
  const PDKeyHash = await _generatePDKeyHash(safleId, password);

  return PDKeyHash;
}

class PBTS {
  constructor(authToken, env) {
    this.authToken = authToken;
    this.env = env;
  }

  async storeKey({ privateKey, password }) {
    const { error: VALIDATE_PASSWORD_ERROR } = await _validatePassword({ password, authToken: this.authToken, env: this.env });

    if (VALIDATE_PASSWORD_ERROR) {
      return { error: VALIDATE_PASSWORD_ERROR };
    }

    const { response: encryptedPrivateKey } = await encryptKey({ privateKey, password });

    const { error: GET_ACCESS_TOKEN_ERROR, response: accessToken } = await getAccessToken({
      params: { password },
      authToken: this.authToken,
      scope: 'transaction',
      env: this.env,
    });

    if (GET_ACCESS_TOKEN_ERROR) {
      return { error: GET_ACCESS_TOKEN_ERROR };
    }

    const { auth: AUTH_SERVICE_URL } = await getBaseUrl(this.env);

    const url = `${AUTH_SERVICE_URL}/auth/private-key`;

    const { response, error: STORE_KEY_ERROR } = await postRequestWithAccessToken({
      params: { encryptedPrivateKey },
      url,
      authToken: this.authToken,
      accessToken,
    });

    if (STORE_KEY_ERROR) {
      return { error: STORE_KEY_ERROR };
    }

    return { response };
  }

  async getEncryptedPrivateKey({ password }) {
    const { error: VALIDATE_PASSWORD_ERROR } = await _validatePassword({ password, authToken: this.authToken, env: this.env });

    if (VALIDATE_PASSWORD_ERROR) {
      return { error: VALIDATE_PASSWORD_ERROR };
    }

    const { error: GET_ACCESS_TOKEN_ERROR, response: accessToken } = await getAccessToken({
      params: { password },
      authToken: this.authToken,
      scope: 'transaction',
      env: this.env,
    });

    if (GET_ACCESS_TOKEN_ERROR) {
      return { error: GET_ACCESS_TOKEN_ERROR };
    }

    const { auth: AUTH_SERVICE_URL } = await getBaseUrl(this.env);

    const { data, error: GET_ENCRYPTED_PRIVATE_KEY_ERROR } = await getRequest({
      url: `${AUTH_SERVICE_URL}/auth/private-key`,
      authToken: this.authToken,
      accessToken,
    });

    if (data) {
      return { response: data.data.encryptedPrivateKey };
    }

    return { error: GET_ENCRYPTED_PRIVATE_KEY_ERROR };
  }

  async signAndSendTx({
    password, rawTx, network, encryptedPrivateKey,
  }) {
    let encryptedPKey;

    if (!encryptedPrivateKey) {
      const { error: GET_KEY_ERROR, response: encryptedpKey } = await this.getEncryptedPrivateKey({ password });

      if (GET_KEY_ERROR) {
        return { error: GET_KEY_ERROR };
      }

      encryptedPKey = encryptedpKey;
    } else {
      encryptedPKey = encryptedPrivateKey;
    }

    const { error: DECRYPT_KEY_ERROR, response: privateKey } = await decryptKey(encryptedPKey, password);

    if (DECRYPT_KEY_ERROR) {
      return { error: DECRYPT_KEY_ERROR };
    }

    const pKey = privateKey.slice(2);
    const { response, error: SEND_TX_ERROR } = await sendTransaction({ privateKey: pKey, rawTx, network });

    if (SEND_TX_ERROR) {
      return { error: SEND_TX_ERROR };
    }

    return { response };
  }

  async changePassword({
    encryptedPrivateKey, oldPassword, newPassword, confirmPassword,
  }) {
    if (newPassword !== confirmPassword) {
      return { error: PASSWORD_MATCH_ERROR };
    }

    const { error: DECRYPT_KEY_ERROR, response: privateKey } = await decryptKey(encryptedPrivateKey, oldPassword);

    if (DECRYPT_KEY_ERROR) {
      return { error: DECRYPT_KEY_ERROR };
    }

    const { response: newEncryptedPrivateKey } = await encryptKey({ privateKey, password: newPassword });

    const { error: UPDATE_PASSWORD_ERROR } = await updatePasswordAndPrivateKey({
      password: newPassword,
      encryptedPrivateKey: newEncryptedPrivateKey,
      authToken: this.authToken,
      env: this.env,
    });

    if (UPDATE_PASSWORD_ERROR) {
      return { error: UPDATE_PASSWORD_ERROR };
    }

    return { response: PASSWORD_CHANGE_SUCCESS };
  }

  async resetPassword({
    privateKey, seedPhrase, encryptedJson, walletPassword, newPassword,
  }) {
    const { error: PRIVATE_KEY_ERROR, response } = await extractPrivateKey({
      privateKey, seedPhrase, encryptedJson, password: walletPassword,
    });

    if (PRIVATE_KEY_ERROR) {
      return { error: PRIVATE_KEY_ERROR };
    }

    const { error: VERIFY_PUBLIC_ADDRESS_ERROR } = await verifyPublicAddress({ address: response.publicAddress, authToken: this.authToken, env: this.env });

    if (VERIFY_PUBLIC_ADDRESS_ERROR) {
      return { error: VERIFY_PUBLIC_ADDRESS_ERROR };
    }

    const { response: newEncryptedPrivateKey } = await encryptKey({ privateKey, password: newPassword });

    const { error: UPDATE_PASSWORD_ERROR } = await updatePasswordAndPrivateKey({
      password: newPassword,
      encryptedPrivateKey: newEncryptedPrivateKey,
      authToken: this.authToken,
      env: this.env,
    });

    if (UPDATE_PASSWORD_ERROR) {
      return { error: UPDATE_PASSWORD_ERROR };
    }

    return { response: PASSWORD_CHANGE_SUCCESS };
  }

  async deleteKey({ password }) {
    const { error: GET_ACCESS_TOKEN_ERROR, response: accessToken } = await getAccessToken({
      params: { password },
      authToken: this.authToken,
      scope: 'delete_private_key',
      env: this.env,
    });

    if (GET_ACCESS_TOKEN_ERROR) {
      return { error: GET_ACCESS_TOKEN_ERROR };
    }

    const { auth: AUTH_SERVICE_URL } = await getBaseUrl(this.env);

    const url = `${AUTH_SERVICE_URL}/auth/encrypted-private-key`;

    const { error: DELETE_ERROR } = await deleteRequest({
      url, authToken: this.authToken, accessToken,
    });

    if (DELETE_ERROR) {
      return { error: DELETE_ERROR };
    }

    return { response: DELETE_SUCCESS };
  }

  async registerSafleId({ publicAddress, privateKey, password }) {
    const { error: STORE_KEY_ERROR } = await this.storeKey({ privateKey, password });

    if (STORE_KEY_ERROR) {
      return { error: STORE_KEY_ERROR };
    }

    const { error, response } = await relayTransaction({
      publicAddress, privateKey, authToken: this.authToken, env: this.env,
    });

    if (error) {
      return { error };
    }

    return { response };
  }
}

class LoginViaSafle {
  constructor(accessToken, env) {
    this.accessToken = accessToken;
    this.env = env;
  }

  async login({ userName, password }) {
    const { auth: AUTH_SERVICE_URL } = await getBaseUrl(this.env);

    const url = `${AUTH_SERVICE_URL}/auth/login`;
    const params = { userName, password };

    const { error, response } = await postRequestForLoginViaSafle({ url, params, accessToken: this.accessToken });

    if (error) {
      return { error };
    }

    const { token } = response;

    localStorage.set('token', token);

    return { response: token };
  }

  async logout() {
    localStorage.clear();

    return { response: LOGOUT_SUCCESS };
  }
}

class SafleWallet {
  async createWallet() {
    const wallet = Wallet.createRandom();

    const seedString = wallet.mnemonic;

    seeds = seedString.split(' ');

    return {
      response: { wallet },
    };
  }

  async importFromMnemonic(mnemonic) {
    try {
      const wallet = Wallet.fromMnemonic(mnemonic);

      return {
        response: { wallet },
      };
    } catch (error) {
      return { error: INVALID_MNEMONIC };
    }
  }

  async importFromEncryptedJson(jsonData, password) {
    const json = JSON.stringify(jsonData);

    try {
      const wallet = await Wallet.fromEncryptedJson(json, password);

      return {
        response: { wallet },
      };
    } catch (error) {
      return { error: WRONG_PASSWORD };
    }
  }

  async generateRandomNumber() {
    firstNumber = Math.floor(Math.random() * 11 + 1);
    secondNumber = Math.floor(Math.random() * 11 + 1);

    while (secondNumber === firstNumber) {
      secondNumber = Math.floor(Math.random() * 11 + 1);
    }

    return { response: { firstNumber, secondNumber } };
  }

  async validateSeeds({ firstWord, secondWord }) {
    if (firstWord === seeds[firstNumber - 1] && secondWord === seeds[secondNumber - 1]) {
      return { response: true };
    }

    return { response: false };
  }
}

module.exports = {
  PBTS, LoginViaSafle, SafleWallet, Vault, encryptEncryptionKey, hashPassword, generatePDKeyHash,
};
