import { Redirect } from 'expo-router';

/** `/account` was the old account screen; the Me tab replaced it. */
export default function AccountIndex() {
  return <Redirect href="/me" />;
}
