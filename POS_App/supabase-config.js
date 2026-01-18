// Supabase configuration - uses Zeabur environment variables at runtime

// Zeabur injects env vars as window.<VAR_NAME> for static sites in some cases,
// but to be safe, we'll check multiple common patterns
const supabaseUrl = window.SUPABASE_URL || 
                    (window.ENV && window.ENV.SUPABASE_URL) || 
                    'https://your-project.supabase.co';  // fallback - change if needed

const supabaseKey = window.SUPABASE_ANON_KEY || 
                    (window.ENV && window.ENV.SUPABASE_ANON_KEY) || 
                    'your-anon-key-here';  // fallback - change if needed

// Initialize Supabase client
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

console.log('Supabase connected with URL:', supabaseUrl);
