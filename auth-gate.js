/* Phase 1: Supabase identity. Do not confuse a successful login with online multiplayer. */
(() => {
  'use strict';
  const $ = (s) => document.getElementById(s);
  const gate = $('authGate'), form = $('authForm'), email = $('authEmail'), password = $('authPassword');
  const submit = $('authSubmit'), tabs = $('authTabs'), siTab = $('authSignInTab'), suTab = $('authSignUpTab');
  const msg = $('authMessage'), subtitle = $('authSubtitle'), aux = $('authAux'), cancel = $('authCancel');
  const acc = $('accountControl'), accName = $('authAccountName');
  const config = window.CHESS_SUPABASE || {};
  let mode = 'signin';
  let recovering = false;
  let client = null;
  const setMessage = (message, error = false) => { msg.textContent = message; msg.classList.toggle('error', error); };
  const busy = (on) => { submit.disabled = on; submit.textContent = on ? 'Please wait…' : ({signin:'Sign in',signup:'Create account',forgot:'Send reset email',update:'Update password'})[mode]; };
  const showUser = (user) => {
    if (recovering) return;
    gate.hidden = !!user;
    acc.hidden = !user;
    accName.textContent = user?.email || '';
    if (user) setMessage('');
  };
  const setMode = (next) => {
    mode = next;
    recovering = next === 'update';
    gate.hidden = false;
    tabs.hidden = !['signin', 'signup'].includes(mode);
    siTab.classList.toggle('active', mode === 'signin');
    suTab.classList.toggle('active', mode === 'signup');
    $('passwordGroup').hidden = mode === 'forgot';
    $('authEmail').parentElement.querySelector('label[for="authEmail"]').hidden = mode === 'update';
    email.hidden = mode === 'update';
    password.autocomplete = mode === 'signup' || mode === 'update' ? 'new-password' : 'current-password';
    $('authPasswordLabel').textContent = mode === 'update' ? 'New password' : 'Password';
    aux.hidden = mode !== 'signin';
    cancel.hidden = !['forgot','update'].includes(mode);
    subtitle.textContent = ({signin:'Sign in to your account to play.', signup:'Use your email and create a password.', forgot:'We will email you a password-reset link.', update:'Choose a new password for your account.'})[mode];
    password.value = '';
    setMessage('');
    busy(false);
  };
  siTab.addEventListener('click', () => setMode('signin'));
  suTab.addEventListener('click', () => setMode('signup'));
  aux.addEventListener('click', () => setMode('forgot'));
  cancel.addEventListener('click', () => { recovering = false; setMode('signin'); });
  setMode('signin');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url || '') || !/^sb_publishable_|^eyJ/.test(config.publishableKey || '')) {
    submit.disabled = true;
    setMessage('Site setup is incomplete. Add the Supabase Project URL and publishable key to config.js.', true);
    return;
  }
  if (!window.supabase?.createClient) {
    submit.disabled = true;
    setMessage('Unable to load the login service. Check the connection and reload.', true);
    return;
  }
  try { client = window.supabase.createClient(config.url, config.publishableKey, { auth: { autoRefreshToken:true, persistSession:true, detectSessionInUrl:true } }); }
  catch (e) { submit.disabled = true; setMessage('The login service could not start: ' + e.message, true); return; }
  window.chessSupabase = client;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const userEmail = email.value.trim();
    const userPassword = password.value;
    if (mode !== 'update' && (!userEmail || !email.checkValidity())) { setMessage('Enter a valid email address.', true); return; }
    if (mode !== 'forgot' && userPassword.length < 8) { setMessage('Use at least 8 characters for your password.', true); return; }
    busy(true);
    setMessage('');
    try {
      if (mode === 'signin') {
        const {data,error} = await client.auth.signInWithPassword({email:userEmail,password:userPassword});
        if (error) throw error;
        showUser(data.user);
      } else if (mode === 'signup') {
        const {data,error} = await client.auth.signUp({email:userEmail,password:userPassword,options:{emailRedirectTo:location.origin+'/'}});
        if (error) throw error;
        if (data.session) showUser(data.user);
        else setMessage('Account request received. Check your email for a confirmation link, then sign in.');
      } else if (mode === 'forgot') {
        const {error} = await client.auth.resetPasswordForEmail(userEmail,{redirectTo:location.origin+'/'});
        if (error) throw error;
        setMessage('If this address has an account, you will receive a reset email.');
      } else if (mode === 'update') {
        const {error} = await client.auth.updateUser({password:userPassword});
        if (error) throw error;
        recovering = false;
        setMode('signin');
        const {data} = await client.auth.getUser();
        showUser(data.user);
      }
    } catch (e) {
      setMessage(e?.message || 'Unable to complete that request. Try again.', true);
    } finally { busy(false); }
  });
  $('authSignOut').addEventListener('click', async () => {
    $('authSignOut').disabled = true;
    const {error} = await client.auth.signOut();
    $('authSignOut').disabled = false;
    if (error) { alert('Sign-out failed: ' + error.message); return; }
    recovering = false;
    setMode('signin');
    showUser(null);
  });
  client.auth.onAuthStateChange((event,session) => {
    if (event === 'PASSWORD_RECOVERY') { setMode('update'); return; }
    if (event === 'SIGNED_OUT') { recovering = false; showUser(null); return; }
    if (!recovering) showUser(session?.user || null);
  });
  client.auth.getSession().then(({data,error}) => {
    if (error) { setMessage('Unable to check your account. Try reloading.', true); return; }
    if (!recovering) showUser(data.session?.user || null);
  }).catch((e) => setMessage('Unable to check your account: ' + e.message, true));
})();