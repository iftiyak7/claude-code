// App entry. The background task must be defined before the router boots so
// it also exists when Android wakes the app headlessly.
import './src/notifications/background';
import 'expo-router/entry';
