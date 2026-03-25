/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { MapContainer, TileLayer, FeatureGroup, GeoJSON } from 'react-leaflet';
import { EditControl } from "react-leaflet-draw";
import { kml } from '@tmcw/togeojson';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { Map as MapIcon, FileUp, Download, Trash2, LogOut } from 'lucide-react';

import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';

// Configuración Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = (supabaseUrl && supabaseAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null;

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [puntos, setPuntos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const mapRef = useRef<any>();

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchPuntos();
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchPuntos();
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchPuntos() {
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.from('puntos_hidricos').select('*');
      if (error) throw error;
      setPuntos(data || []);
    } catch (error) {
      console.error('Error fetching points:', error);
    } finally {
      setLoading(false);
    }
  }

  // Manejador de subida de archivos KML
  const handleKMLUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session || !supabase) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      if (!event.target?.result || !supabase) return;
      const xml = new DOMParser().parseFromString(event.target.result as string, "text/xml");
      const geojson = kml(xml);
      
      for (const feature of geojson.features) {
        await supabase.from('puntos_hidricos').insert([{
          user_id: session.user.id,
          nombre: (feature.properties as any)?.name || "Punto KML",
          tipo_geometria: feature.geometry.type,
          geojson: feature,
        }]);
      }
      fetchPuntos();
    };
    reader.readAsText(file);
  };

  // Generar Informe PDF
  const generarInforme = () => {
    const doc = new jsPDF() as any;
    doc.text("Informe de Monitoreo Hídrico - HydroSource", 20, 20);
    
    const tableData = puntos.map(p => [
      p.nombre, 
      p.tipo_geometria, 
      p.notas || 'Sin notas', 
      new Date(p.created_at).toLocaleDateString()
    ]);
    
    doc.autoTable({
      head: [['Nombre', 'Tipo', 'Notas', 'Fecha']],
      body: tableData,
      startY: 30
    });
    
    doc.save("informe-hidrico.pdf");
  };

  const handleAnonymousLogin = async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        if (error.message.includes("disabled")) {
          throw new Error("El acceso de invitado está desactivado. Activa 'Anonymous' en Authentication -> Providers en tu panel de Supabase.");
        }
        throw error;
      }
      setSession(data.session);
    } catch (error: any) {
      alert("⚠️ Configuración requerida: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (!supabaseUrl || !supabaseAnonKey) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-4">Configuración Requerida</h2>
          <p className="text-gray-600 mb-6">
            Por favor, configura las variables de entorno <strong>VITE_SUPABASE_URL</strong> y <strong>VITE_SUPABASE_ANON_KEY</strong> en el panel de Secretos.
          </p>
        </div>
      </div>
    );
  }

  if (!session) return <Login setSession={setSession} handleAnonymousLogin={handleAnonymousLogin} />;

  return (
    <div className="flex h-screen bg-gray-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-80 bg-white shadow-xl flex flex-col p-4 z-[1000] relative">
        <div className="flex items-center gap-2 mb-8 border-b pb-4">
          <MapIcon className="text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">HydroSource</h1>
        </div>

        <div className="flex flex-col gap-4 mb-6">
          <label className="flex items-center justify-center gap-2 p-2 bg-blue-50 text-blue-700 rounded-lg cursor-pointer hover:bg-blue-100 transition">
            <FileUp size={18} /> Subir KML
            <input type="file" className="hidden" accept=".kml" onChange={handleKMLUpload} />
          </label>
          
          <button 
            onClick={generarInforme} 
            className="flex items-center justify-center gap-2 p-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
          >
            <Download size={18} /> Descargar PDF
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-2">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Puntos Registrados</h2>
          {loading ? (
            <div className="text-center py-4 text-gray-400">Cargando...</div>
          ) : puntos.length === 0 ? (
            <div className="text-center py-4 text-gray-400 italic">No hay puntos registrados</div>
          ) : (
            puntos.map(p => (
              <div key={p.id} className="p-3 mb-2 bg-gray-50 rounded-md border hover:border-blue-400 cursor-pointer transition group relative">
                <p className="font-medium text-gray-800">{p.nombre}</p>
                <p className="text-xs text-gray-500 italic">{p.tipo_geometria}</p>
                <button 
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (confirm('¿Eliminar este punto?') && supabase) {
                      await supabase.from('puntos_hidricos').delete().eq('id', p.id);
                      fetchPuntos();
                    }
                  }}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 transition"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>

        <button 
          onClick={() => supabase?.auth.signOut()} 
          className="mt-4 flex items-center gap-2 text-gray-600 hover:text-red-600 transition p-2 rounded hover:bg-red-50"
        >
          <LogOut size={18} /> Cerrar Sesión
        </button>
      </aside>

      {/* Mapa Principal */}
      <main className="flex-1 relative">
        <MapContainer 
          center={[10.5, -66.9]} 
          zoom={13} 
          className="h-full w-full" 
          ref={mapRef}
        >
          <TileLayer 
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" 
          />
          
          <FeatureGroup>
            <EditControl
              position="topright"
              onCreated={async (e: any) => {
                if (!supabase || !session) return;
                const { layer } = e;
                const geojson = layer.toGeoJSON();
                const nombre = prompt("Nombre del punto/zona:");
                if (nombre === null) return; // Cancelled
                const notas = prompt("Notas adicionales:");

                await supabase.from('puntos_hidricos').insert([{
                  user_id: session.user.id,
                  nombre: nombre || "Nuevo Punto",
                  notas: notas,
                  tipo_geometria: geojson.geometry.type,
                  geojson: geojson
                }]);
                fetchPuntos();
              }}
              draw={{
                rectangle: false,
                circle: false,
                circlemarker: false,
              }}
            />
            {puntos.map(p => (
              <GeoJSON key={p.id} data={p.geojson} />
            ))}
          </FeatureGroup>
        </MapContainer>
      </main>
    </div>
  );
}

// Componente de Login Simple
function Login({ setSession, handleAnonymousLogin }: { setSession: (s: any) => void, handleAnonymousLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        
        if (data.session) {
          setSession(data.session);
        } else {
          setErrorMsg('¡Registro exitoso! Por favor, confirma tu correo o desactiva "Confirm Email" en Supabase.');
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setSession(data.session);
      }
    } catch (error: any) {
      setErrorMsg(error.message);
    } finally {
      setLoading(false);
    }
  };

  const onGuestLogin = async () => {
    setErrorMsg(null);
    try {
      await handleAnonymousLogin();
    } catch (error: any) {
      setErrorMsg(error.message);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-blue-600 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex justify-center mb-6">
          <div className="bg-blue-100 p-3 rounded-full">
            <MapIcon className="text-blue-600 w-8 h-8" />
          </div>
        </div>
        <h2 className="text-2xl font-bold mb-2 text-center text-gray-800">
          HydroSource
        </h2>
        <p className="text-center text-gray-500 mb-6 text-sm">Plataforma de Monitoreo Hídrico</p>
        
        {errorMsg && (
          <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm rounded">
            <p className="font-bold">⚠️ Error de Configuración:</p>
            <p>{errorMsg}</p>
            <div className="mt-2 text-xs opacity-80">
              <p>1. Ve a Supabase &rarr; Authentication &rarr; Providers</p>
              <p>2. Activa "Anonymous" y desactiva "Confirm Email"</p>
            </div>
          </div>
        )}

        <button 
          onClick={onGuestLogin}
          disabled={loading}
          className="w-full bg-green-600 text-white p-4 rounded-xl font-bold mb-6 hover:bg-green-700 transition shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? 'Entrando...' : '🚀 Entrar como Invitado (Sin Registro)'}
        </button>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-gray-200"></span></div>
          <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-gray-400">O usa tu cuenta</span></div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input 
              type="email" 
              required
              placeholder="Email" 
              className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition" 
              onChange={e => setEmail(e.target.value)} 
            />
          </div>
          <div>
            <input 
              type="password" 
              required
              placeholder="Contraseña" 
              className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition" 
              onChange={e => setPassword(e.target.value)} 
            />
          </div>
          <button 
            disabled={loading}
            className="w-full bg-blue-600 text-white p-3 rounded-lg font-bold hover:bg-blue-700 transition disabled:opacity-50"
          >
            {isSignUp ? 'Crear Cuenta' : 'Iniciar Sesión'}
          </button>
        </form>

        <p className="text-center mt-6 text-sm text-gray-600">
          {isSignUp ? '¿Ya tienes cuenta?' : '¿Quieres una cuenta propia?'}
          <button 
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="ml-1 text-blue-600 font-semibold hover:underline"
          >
            {isSignUp ? 'Inicia sesión' : 'Regístrate'}
          </button>
        </p>
      </div>
    </div>
  );
}
