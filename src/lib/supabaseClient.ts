import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // Message clair si le fichier .env n'a pas été rempli, plutôt qu'une
  // erreur technique obscure plus loin dans l'application.
  throw new Error(
    "Configuration Supabase manquante : vérifiez que le fichier .env contient bien VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY (voir .env.example)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
