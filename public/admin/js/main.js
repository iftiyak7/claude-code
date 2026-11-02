/* Jashore360 admin panel: loads every module, then starts them in order. Strings are written in Bangla and wrapped in T(); English lives in /i18n.js. */
import { init as init_util } from './util.js';
import { init as init_dashboard } from './dashboard.js';
import { init as init_listings } from './listings.js';
import { init as init_submissions } from './submissions.js';
import { init as init_classifieds } from './classifieds.js';
import { init as init_coupons } from './coupons.js';
import { init as init_people } from './people.js';
import { init as init_collections } from './collections.js';
import { init as init_system } from './system.js';
import { init as init_router } from './router.js';
import { init as init_events } from './events.js';
import { init as init_boot } from './boot.js';
import './data.js';
import './shell.js';

init_util();
init_dashboard();
init_listings();
init_submissions();
init_classifieds();
init_coupons();
init_people();
init_collections();
init_system();
init_router();
init_events();
init_boot();
