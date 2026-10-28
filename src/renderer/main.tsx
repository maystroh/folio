import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';

const storedTheme = localStorage.getItem('folio-theme');
document.documentElement.dataset.theme = storedTheme === 'dark' ? 'dark' : 'light';

const container = document.getElementById('root');
if (!container) throw new Error('Folio root element is missing.');
createRoot(container).render(<App />);
