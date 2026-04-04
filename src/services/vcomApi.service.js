const axios = require('axios');
const { vcomApiBaseUrl } = require('../config/env');

class VcomApiService {
  constructor() {
    this.client = axios.create({
      baseURL: vcomApiBaseUrl,
      timeout: 15000,
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

  async getEmployees(token) {
    const response = await this.client.get('/api/v1/employees', {
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
