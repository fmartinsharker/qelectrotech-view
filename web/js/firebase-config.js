// Configuração do Firebase. Os valores de firebaseConfig NÃO são segredos (identificam o projecto;
// quem protege os dados são as regras em firestore.rules). Preencher depois de criar o projecto
// (Firebase Console → Project settings → Your apps → Web app → firebaseConfig).
//
// Se firebaseConfig for null a página funciona só em modo local (notas no browser).

export const firebaseConfig = {
  apiKey: "AIzaSyBJ6YU1ZAPSL_Nok58Rz5fezEvD1EofP2c",
  // o mesmo endereço da página: evita o erro "missing initial state" (armazenamento isolado entre domínios)
  authDomain: "qelectrotechview.web.app",
  projectId: "harker-solutions",
  appId: "1:373671294771:web:93da555e7dea028def3046",
};
// Exemplo:
// export const firebaseConfig = {
//   apiKey: "…", authDomain: "o-vosso-projecto.firebaseapp.com", projectId: "o-vosso-projecto", appId: "…",
// };

/** ID do directório (tenant) Microsoft da organização, ou o domínio (ex. "harkersolutions.com"). */
export const microsoftTenant = "3919de34-55c3-4496-a636-594f5c2b1456";

/** Só contas deste domínio entram (a regra que conta está em firestore.rules; isto avisa logo na página). */
export const emailDomain = "harkersolutions.com";

/** Quem pode apagar notas (tem de coincidir com o email em firestore.rules; as regras é que impõem). */
export const notesAdmin = "francisco.martins@harkersolutions.com";
