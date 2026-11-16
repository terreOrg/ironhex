import {randomBytes} from 'node:crypto';
import {AuthError, tokenHash, hashPassword, validateNewPassword} from './auth.mjs';

// One-time, randomly generated links. Only SHA-256 token digests are persisted.
const TOKEN = /^[0-9a-f]{64}$/;
const expiry = {verify:24*60*60,reset:30*60};
export function createAccountFlows(pool,{mailer}) {
  async function issue(commanderId,email,purpose) {
    if (!mailer?.enabled) throw new AuthError(503,'mail_unavailable');
    const token = randomBytes(32).toString('hex');
    const digest = tokenHash(token);
    // A new token invalidates previously issued links of the same purpose.
    await pool.query('DELETE FROM commander_action_tokens WHERE commander_id=$1 AND purpose=$2',
      [commanderId,purpose]);
    await pool.query(
      'INSERT INTO commander_action_tokens(token_hash,commander_id,purpose,expires_at) ' +
      'VALUES($1,$2,$3,now() + ($4::int * interval \'1 second\'))',
      [digest,commanderId,purpose,expiry[purpose]]);
    try {
      await mailer.send({to:email,purpose,token});
    } catch(error) {
      await pool.query('DELETE FROM commander_action_tokens WHERE token_hash=$1',[digest]);
      throw new AuthError(503,'mail_unavailable');
    }
  }
  async function consume(token,purpose,action) {
    if (typeof token !== 'string' || !TOKEN.test(token))
      throw new AuthError(400,'invalid_token');
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const result=await client.query(
        'DELETE FROM commander_action_tokens WHERE token_hash=$1 AND purpose=$2 ' +
        'AND expires_at>now() RETURNING commander_id',
        [tokenHash(token),purpose]);
      if (!result.rows.length) throw new AuthError(400,'invalid_token');
      const id=result.rows[0].commander_id;
      await action(client,id);
      await client.query('COMMIT');
      return {ok:true};
    } catch(error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {client.release();}
  }
  return {
    emailAvailable:!!mailer?.enabled,
    async sendVerification(commanderId) {
      const result=await pool.query(
        'SELECT email,email_verified_at FROM commander_credentials WHERE commander_id=$1',
        [commanderId]);
      const row=result.rows[0];
      if (!row) throw new AuthError(401,'unauthorized');
      if (row.email_verified_at) return {ok:true,alreadyVerified:true};
      await issue(commanderId,row.email,'verify');
      return {ok:true};
    },
    async requestReset(email) {
      if (!mailer?.enabled) throw new AuthError(503,'mail_unavailable');
      if (typeof email !== 'string' || email.length > 254) throw new AuthError(400,'invalid_email');
      const row=(await pool.query(
        'SELECT commander_id,email FROM commander_credentials WHERE email_normalized=$1',
        [email.trim().toLowerCase()])).rows[0];
      if (row) {
        try {await issue(row.commander_id,row.email,'reset');}
        catch {console.warn('Ironhex password recovery mail delivery failed');}
      }
      // No indication whether an e-mail is registered.
      return {ok:true};
    },
    verifyEmail(token) {
      return consume(token,'verify',async(client,id)=>{
        await client.query('UPDATE commander_credentials SET email_verified_at=now() WHERE commander_id=$1',[id]);
      });
    },
    resetPassword(token,password) {
      validateNewPassword(password);
      return consume(token,'reset',async(client,id)=>{
        const hashed=await hashPassword(password);
        await client.query('UPDATE commander_credentials SET password_hash=$2 WHERE commander_id=$1',[id,hashed]);
        await client.query('DELETE FROM commander_sessions WHERE commander_id=$1',[id]);
        await client.query('DELETE FROM commander_action_tokens WHERE commander_id=$1',[id]);
      });
    }
  };
}
