import { Redirect } from 'expo-router';

/** The web's `/account/saved` is the Saved tab in the app. */
export default function AccountSaved() {
  return <Redirect href="/saved" />;
}
