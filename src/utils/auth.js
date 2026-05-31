/**
 * Compara se o email pertence ao Dono Supremo (Super Admin).
 */
const isSuperOwner = (email) => {
  if (!email) return false;
  return email === process.env.SUPER_ADMIN_EMAIL;
};

module.exports = {
  isSuperOwner
};
