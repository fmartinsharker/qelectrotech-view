// Configuração do Firebase. Os valores de firebaseConfig NÃO são segredos (identificam o projecto;
// quem protege os dados são as regras em firestore.rules). Preencher depois de criar o projecto
// (Firebase Console → Project settings → Your apps → Web app → firebaseConfig).
//
// Enquanto firebaseConfig for null a página funciona só em modo local (notas no browser).

export const firebaseConfig = null;
// Exemplo:
// export const firebaseConfig = {
//   apiKey: "…", authDomain: "o-vosso-projecto.firebaseapp.com", projectId: "o-vosso-projecto", appId: "…",
// };

/** ID do directório (tenant) Microsoft da organização, ou o domínio (ex. "harkersolutions.com"). */
export const microsoftTenant = "";

/** Só contas deste domínio entram (a regra que conta está em firestore.rules; isto avisa logo na página). */
export const emailDomain = "harkersolutions.com";
