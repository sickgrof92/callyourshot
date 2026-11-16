import { Linking } from 'react-native';
import { API_URL } from './api';

// The full Official Rules and Privacy Policy are web pages served by our server.
export const RULES_URL = `${API_URL}/rules`;
export const PRIVACY_URL = `${API_URL}/privacy`;
export const openRules = () => void Linking.openURL(RULES_URL);
export const openPrivacy = () => void Linking.openURL(PRIVACY_URL);
