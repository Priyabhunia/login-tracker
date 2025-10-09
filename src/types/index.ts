// Types for the Login Tracker Extension

export interface LoginData {
  email: string;
  website: string;
  timestamp: number;
  url: string;
  method?: 'oauth' | 'manual';
}

export interface WebsiteLoginHistory {
  [website: string]: LoginData[];
}

export interface APICallData {
  url: string;
  method: string;
  data?: any;
  headers?: { [key: string]: string };
  timestamp: number;
}

export interface Message {
  type: string;
  data?: any;
}

export interface BackgroundMessage extends Message {
  type: 'LOGIN_DETECTED' | 'GET_HISTORY' | 'CLEAR_HISTORY';
  data?: LoginData | string;
}

export interface ContentMessage extends Message {
  type: 'API_CALL_DETECTED' | 'PAGE_LOADED';
  data?: APICallData;
}