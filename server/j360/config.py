"""Settings that do not change while the server runs, and where its data lives (set once at start-up by set_paths)."""
import mimetypes
import os


HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # the server/ folder
PUBLIC = os.path.normpath(os.path.join(HERE, '..', 'public'))
SEED = os.path.join(HERE, 'seed.json')
DATA = DB_PATH = UPLOADS = DOWNLOADS = None

SESSION_DAYS = 30
ADMIN_SESSION_DAYS = 7          # staff sign in again every week
BACKUP_KEEP = 14               # daily database copies kept in DATA/backups
MAX_BODY = 12 * 1024 * 1024
MAX_APK = 80 * 1024 * 1024
TEXT_TYPES = ('text/', 'application/javascript', 'application/json', 'image/svg+xml', 'application/manifest+json')
mimetypes.add_type('application/manifest+json', '.webmanifest')
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('image/webp', '.webp')
mimetypes.add_type('video/mp4', '.mp4')
mimetypes.add_type('video/webm', '.webm')
mimetypes.add_type('video/quicktime', '.mov')

SETTING_KEYS = ('site', 'areas', 'areaGeo', 'categories', 'notices', 'ads', 'plans', 'payment', 'app', 'terms', 'popup')
DICT_SETTINGS = ('site', 'payment', 'app', 'terms', 'popup', 'areaGeo')
MODERATOR_SETTINGS = {'notices'}           # every other setting is owner-only
CLASS_KINDS = ('job', 'rent', 'mess', 'tuition')
CLASS_DAYS = 30
STATUSES = ('verified', 'pending', 'needs_update', 'temp_closed', 'closed')
MAX_IMAGES, MAX_VIDEOS = 10, 2
MAX_IMAGE_BYTES, MAX_VIDEO_BYTES = 8 * 1024 * 1024, 60 * 1024 * 1024


DOMAIN_FILE = os.environ.get('J360_DOMAIN_FILE', '/etc/jashore360/domain')   # written by the installer


def set_paths(data):
    global DATA, DB_PATH, UPLOADS, DOWNLOADS
    DATA = os.path.abspath(data)
    DB_PATH = os.path.join(DATA, 'jashore360.db')
    UPLOADS = os.path.join(DATA, 'uploads')
    DOWNLOADS = os.path.join(DATA, 'downloads')
