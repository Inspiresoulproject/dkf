const {jwtVerify,createRemoteJWKSet}=require('jose');
const issuer='https://cool-glitter-cd9e.cloudflareaccess.com';
const jwks=createRemoteJWKSet(new URL(issuer+'/cdn-cgi/access/certs'));
async function verifyAdmin(req,res,next){
  const audience=process.env.CF_ACCESS_AUD;
  const token=req.get('Cf-Access-Jwt-Assertion');
  if(!audience||!token)return res.status(401).send('Administrator authentication required');
  try{
    const {payload}=await jwtVerify(token,jwks,{issuer,audience,algorithms:['RS256']});
    const email=String(payload.email||'').trim().toLowerCase();
    const allowed=(process.env.DKF_ADMIN_EMAILS||'help@digitalkidsfoundation.org').split(',').map(x=>x.trim().toLowerCase());
    if(!email||!allowed.includes(email))return res.status(403).send('Administrator access denied');
    req.dkfAdminEmail=email;
    res.set('Cache-Control','no-store');
    next();
  }catch(err){return res.status(401).send('Invalid or expired administrator session')}
}
module.exports={verifyAdmin};
