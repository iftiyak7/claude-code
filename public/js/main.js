/* Jashore360 app: loads every module, then starts them in order. Strings are written in Bangla and wrapped in T(). */
import { init as init_util } from './util.js';
import { init as init_data } from './data.js';
import { init as init_pages } from './pages.js';
import { init as init_page_classifieds } from './page_classifieds.js';
import { init as init_page_account } from './page_account.js';
import { init as init_page_post } from './page_post.js';
import { init as init_router } from './router.js';
import { init as init_events } from './events.js';
import { init as init_boot } from './boot.js';
import './components.js';
import './ads.js';
import './search.js';
import './sheets.js';
import './gates.js';

init_util();
init_data();
init_pages();
init_page_classifieds();
init_page_account();
init_page_post();
init_router();
init_events();
init_boot();
