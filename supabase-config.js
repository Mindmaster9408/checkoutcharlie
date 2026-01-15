// Supabase configuration
const supabaseUrl = 'https://syxyftdhwmdrttifnsga.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5eHlmdGRod21kcnR0aWZuc2dhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0NjY3OTIsImV4cCI6MjA4NDA0Mjc5Mn0.8Y0jD64ZjAzcIQSc1jmW9iXjR5sVpXFrhigzH4o40jk'

// Initialize Supabase client
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey)

console.log('Supabase connected!')
