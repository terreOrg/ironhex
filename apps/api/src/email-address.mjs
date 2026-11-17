// Linear validation of the existing address format: one @, no whitespace,
// a non-empty domain prefix and the requested number of suffix characters.
// This is deliberately not a full RFC mailbox parser.
export function validEmailAddress(value,{maxLocalLength=Infinity,minSuffixLength=1}={}){
  if(typeof value!=='string'||/\s/.test(value))return false;
  const at=value.indexOf('@');
  if(at<1||at>maxLocalLength||at!==value.lastIndexOf('@'))return false;
  const domain=value.slice(at+1);
  const dot=domain.indexOf('.',1);
  return dot>=1&&domain.length-dot-1>=minSuffixLength;
}
