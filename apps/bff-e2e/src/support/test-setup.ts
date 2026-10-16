import axios from 'axios';

axios.defaults.baseURL = `${process.env['BFF_URL'] ?? 'http://localhost:3300'}/api/v1`;
// Assert on status codes explicitly instead of letting axios throw on every 4xx.
axios.defaults.validateStatus = () => true;
