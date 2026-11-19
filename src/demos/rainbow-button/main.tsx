import React from 'react';
import { createRoot } from 'react-dom/client';
import DemoOne from './demo';

const root = document.getElementById('root');
if (!root) throw new Error('Rainbow button demo root is missing');
createRoot(root).render(<DemoOne />);
