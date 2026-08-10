const axios = require('axios');
const { vcomApiBaseUrl } = require('../config/env');

class VcomApiService {
  constructor() {
    this.client = axios.create({
      baseURL: vcomApiBaseUrl,
      // chat-directory puede traer fotos base64; 15s se queda corto desde la VPS.
      timeout: 45000,
    });
  }

  async getPermissions(token) {
    const response = await this.client.get('/api/v1/auth/permissions', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  }

  async getUsers(token) {
    const response = await this.client.get('/api/v1/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  }

  async getUserById(token, userId) {
    const response = await this.client.get(`/api/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  }

  async getModels(token) {
    const response = await this.client.get('/api/v1/models', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  }

  /** Directorio simplificado de modelos para el chat (sin restricciones de rol). */
  async getModelsChatDirectory(token) {
    const response = await this.client.get('/api/v1/models/chat-directory', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  }

  async getEmployees(token) {
    const response = await this.client.get('/api/v1/employees', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  }

  /** Directorio simplificado de empleados para el chat (sin restricciones de rol). */
  async getEmployeesChatDirectory(token) {
    const response = await this.client.get('/api/v1/employees/chat-directory', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  }

  async getRoles(token) {
    const response = await this.client.get('/api/v1/roles', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  }
}

module.exports = new VcomApiService();
