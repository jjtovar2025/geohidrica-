/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { MapContainer, TileLayer, FeatureGroup, GeoJSON, LayersControl, Popup } from 'react-leaflet';
import { EditControl } from "react-leaflet-draw";
import L from 'leaflet';
import { kml } from '@tmcw/togeojson';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Map as MapIcon, FileUp, Download, Trash2, LogOut, Layers, Info, Database, Save, X } from 'lucide-react';

import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';

// Parche para eliminar el Warning de "_flat" en Leaflet 1.9+
// Esto evita que la consola se llene de mensajes de advertencia innecesarios
if (typeof window !== 'undefined') {
  (L.Polyline.prototype as any)._flat = function (this: any) {
    return L.LineUtil.isFlat(this._latlngs);
  };
}

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
  const [selectedPunto, setSelectedPunto] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [tempLayer, setTempLayer] = useState<any>(null);
  const mapRef = useRef<any>();

  useEffect(() => {
    if (!supabase) {
      setSession({ user: { id: 'demo-user' } });
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSession(session);
        fetchPuntos();
      } else {
        setSession({ user: { id: 'demo-user' }, isDemo: true });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setSession(session);
        fetchPuntos();
      } else {
        setSession({ user: { id: 'demo-user' }, isDemo: true });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchPuntos() {
    if (!supabase || session?.isDemo) return;
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

  const handleKMLUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        if (!event.target?.result) return;
        const text = event.target.result as string;
        const xml = new DOMParser().parseFromString(text, "text/xml");
        
        if (xml.getElementsByTagName("parsererror").length > 0) {
          throw new Error("Error al leer el archivo XML/KML. Asegúrate de que es un archivo KML válido.");
        }

        const geojson = kml(xml);
        if (!geojson || !geojson.features || geojson.features.length === 0) {
          throw new Error("El archivo KML no contiene geometrías válidas.");
        }
        
        const newPoints = [];
        for (const feature of geojson.features) {
          const point = {
            id: crypto.randomUUID(),
            user_id: session.user.id,
            nombre: (feature.properties as any)?.name || "Punto KML",
            sector: "Importado",
            quebrada: "N/A",
            rio: "N/A",
            tipo_geometria: feature.geometry.type,
            geojson: feature,
            created_at: new Date().toISOString()
          };
          
          if (supabase && !session.isDemo) {
            await supabase.from('puntos_hidricos').insert([point]);
          }
          newPoints.push(point);
        }
        
        if (session.isDemo) {
          setPuntos(prev => [...prev, ...newPoints]);
        } else {
          fetchPuntos();
        }
        alert(`¡Éxito! Se importaron ${newPoints.length} elementos.`);
      } catch (err: any) {
        alert("Error con el KML: " + err.message);
      }
    };
    reader.readAsText(file);
  };

  const generarInforme = () => {
    const doc = new jsPDF() as any;
    doc.setFontSize(16);
    doc.text("Informe de Monitoreo Hídrico - HydroSource", 20, 20);
    
    const tableData = puntos.map(p => [
      p.nombre, 
      p.sector || 'N/A',
      p.quebrada || 'N/A',
      p.rio || 'N/A',
      p.tipo_geometria, 
      new Date(p.created_at).toLocaleDateString()
    ]);
    
    autoTable(doc, {
      head: [['Nombre', 'Sector', 'Quebrada', 'Río', 'Tipo', 'Fecha']],
      body: tableData,
      startY: 30,
      styles: { fontSize: 8 }
    });
    
    doc.save("informe-hidrico.pdf");
  };

  const handleEdit = (punto: any) => {
    setSelectedPunto(punto);
    setEditForm(punto);
    setIsEditing(true);
  };

  const saveEdit = async () => {
    if (!supabase || !selectedPunto) return;
    setLoading(true);
    try {
      const isNew = !puntos.find(p => p.id === selectedPunto.id);
      
      if (!session.isDemo) {
        if (isNew) {
          const { error } = await supabase.from('puntos_hidricos').insert([editForm]);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('puntos_hidricos')
            .update({
              nombre: editForm.nombre,
              sector: editForm.sector,
              quebrada: editForm.quebrada,
              rio: editForm.rio,
              notas: editForm.notas
            })
            .eq('id', selectedPunto.id);
          if (error) throw error;
        }
        fetchPuntos();
      } else {
        if (isNew) {
          setPuntos(prev => [...prev, editForm]);
        } else {
          setPuntos(prev => prev.map(p => p.id === selectedPunto.id ? { ...p, ...editForm } : p));
        }
      }

      if (tempLayer) {
        tempLayer.remove();
        setTempLayer(null);
      }

      setSelectedPunto({ ...selectedPunto, ...editForm });
      setIsEditing(false);
      alert("¡Registro guardado con éxito!");
    } catch (error) {
      console.error('Error saving point:', error);
      alert("Error al guardar el registro");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-gray-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-80 bg-white shadow-xl flex flex-col z-[1000] relative border-r">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <MapIcon className="text-blue-600" />
              <h1 className="text-xl font-bold text-gray-800">HydroSource</h1>
            </div>
            {session?.isDemo && (
              <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold uppercase">Demo</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col items-center justify-center gap-1 p-2 bg-blue-50 text-blue-700 rounded-lg cursor-pointer hover:bg-blue-100 transition text-xs font-semibold">
              <FileUp size={16} /> KML
              <input type="file" className="hidden" accept=".kml" onChange={handleKMLUpload} />
            </label>
            
            <button 
              onClick={generarInforme} 
              className="flex flex-col items-center justify-center gap-1 p-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-xs font-semibold"
            >
              <Download size={16} /> Informe
            </button>
          </div>
        </div>

        {/* Ficha Técnica (Si hay seleccionado o creando) */}
        {selectedPunto ? (
          <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-blue-800 flex items-center gap-2 uppercase">
                <Database size={16} /> {isEditing ? (puntos.find(p => p.id === selectedPunto.id) ? 'Editando Ficha' : 'Nueva Ficha') : 'Ficha Técnica'}
              </h2>
              <button 
                onClick={() => { 
                  if (tempLayer) tempLayer.remove();
                  setSelectedPunto(null); 
                  setIsEditing(false); 
                  setTempLayer(null);
                }} 
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Cancelar
              </button>
            </div>
            
            <div className="space-y-4">
              {isEditing ? (
                <div className="space-y-3">
                  <div className="bg-blue-50 p-2 rounded text-[10px] text-blue-700 font-medium mb-2">
                    Completa los datos del punto dibujado en el mapa.
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-bold">Nombre del Punto</label>
                    <input 
                      placeholder="Ej: Toma de Agua Sector A"
                      className="w-full p-2 text-sm border rounded focus:ring-2 focus:ring-blue-400 outline-none" 
                      value={editForm.nombre} 
                      onChange={e => setEditForm({...editForm, nombre: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-bold">Sector / Ubicación</label>
                    <input 
                      placeholder="Ej: Zona Norte"
                      className="w-full p-2 text-sm border rounded focus:ring-2 focus:ring-blue-400 outline-none" 
                      value={editForm.sector} 
                      onChange={e => setEditForm({...editForm, sector: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-bold">Quebrada que Alimenta</label>
                    <input 
                      placeholder="Nombre de la quebrada"
                      className="w-full p-2 text-sm border rounded focus:ring-2 focus:ring-blue-400 outline-none" 
                      value={editForm.quebrada} 
                      onChange={e => setEditForm({...editForm, quebrada: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-bold">Río al que Llega</label>
                    <input 
                      placeholder="Nombre del río"
                      className="w-full p-2 text-sm border rounded focus:ring-2 focus:ring-blue-400 outline-none" 
                      value={editForm.rio} 
                      onChange={e => setEditForm({...editForm, rio: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-bold">Notas</label>
                    <textarea 
                      placeholder="Observaciones adicionales..."
                      className="w-full p-2 text-sm border rounded h-20 focus:ring-2 focus:ring-blue-400 outline-none" 
                      value={editForm.notas} 
                      onChange={e => setEditForm({...editForm, notas: e.target.value})}
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button onClick={saveEdit} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition">
                      <Save size={14} /> Guardar Registro
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="bg-white p-3 rounded-lg shadow-sm border">
                    <label className="text-[10px] text-gray-400 uppercase font-bold">Nombre del Punto</label>
                    <p className="text-sm font-semibold text-gray-800">{selectedPunto.nombre}</p>
                  </div>
                  
                  <div className="bg-white p-3 rounded-lg shadow-sm border">
                    <label className="text-[10px] text-gray-400 uppercase font-bold">Sector / Ubicación</label>
                    <p className="text-sm text-gray-700">{selectedPunto.sector || 'No especificado'}</p>
                  </div>

                  <div className="bg-white p-3 rounded-lg shadow-sm border-l-4 border-blue-400">
                    <label className="text-[10px] text-blue-400 uppercase font-bold">Alimenta a (Quebrada)</label>
                    <p className="text-sm text-gray-700">{selectedPunto.quebrada || 'No especificado'}</p>
                  </div>

                  <div className="bg-white p-3 rounded-lg shadow-sm border-l-4 border-green-400">
                    <label className="text-[10px] text-green-400 uppercase font-bold">Llega a (Río)</label>
                    <p className="text-sm text-gray-700">{selectedPunto.rio || 'No especificado'}</p>
                  </div>

                  <div className="bg-white p-3 rounded-lg shadow-sm border">
                    <label className="text-[10px] text-gray-400 uppercase font-bold">Notas Adicionales</label>
                    <p className="text-xs text-gray-600 italic">{selectedPunto.notas || 'Sin notas'}</p>
                  </div>

                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleEdit(selectedPunto)}
                      className="flex-1 py-2 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-100 transition flex items-center justify-center gap-2"
                    >
                      Editar Información
                    </button>
                    <button 
                      onClick={async () => {
                        if (confirm('¿Eliminar este registro?') && supabase) {
                          if (!session.isDemo) {
                            await supabase.from('puntos_hidricos').delete().eq('id', selectedPunto.id);
                            fetchPuntos();
                          } else {
                            setPuntos(prev => prev.filter(p => p.id !== selectedPunto.id));
                          }
                          setSelectedPunto(null);
                        }
                      }}
                      className="flex-1 py-2 bg-red-50 text-red-600 rounded-lg text-xs font-bold hover:bg-red-100 transition flex items-center justify-center gap-2"
                    >
                      <Trash2 size={14} /> Eliminar
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Inventario Hídrico</h2>
              <button 
                onClick={() => alert("Para crear un nuevo registro, utiliza las herramientas de dibujo en la esquina superior derecha del mapa (iconos de punto o línea).")}
                className="text-[10px] bg-blue-600 text-white px-2 py-1 rounded font-bold hover:bg-blue-700 transition flex items-center gap-1"
              >
                + Nuevo Registro
              </button>
            </div>
            {loading ? (
              <div className="text-center py-8 text-gray-400 animate-pulse">Cargando datos...</div>
            ) : puntos.length === 0 ? (
              <div className="text-center py-8 text-gray-400 italic text-sm">No hay registros. Dibuja en el mapa para empezar.</div>
            ) : (
              <div className="space-y-2">
                {puntos.map(p => (
                  <div 
                    key={p.id} 
                    onClick={() => setSelectedPunto(p)}
                    className="p-3 bg-white rounded-lg border border-gray-100 shadow-sm hover:border-blue-300 cursor-pointer transition group"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-bold text-gray-800">{p.nombre}</p>
                        <p className="text-[10px] text-gray-400 italic">{p.sector || 'Sin sector'}</p>
                      </div>
                      <Info size={14} className="text-gray-300 group-hover:text-blue-500" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="p-4 border-t bg-gray-50">
          <button 
            onClick={() => supabase?.auth.signOut()} 
            className="w-full flex items-center justify-center gap-2 text-gray-500 hover:text-red-600 transition text-sm font-medium"
          >
            <LogOut size={16} /> Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Mapa Principal */}
      <main className="flex-1 relative">
        <MapContainer 
          center={[10.5, -66.9]} 
          zoom={13} 
          className="h-full w-full" 
          ref={mapRef}
        >
          <LayersControl position="topright">
            <LayersControl.BaseLayer checked name="Mapa Estándar">
              <TileLayer 
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" 
              />
            </LayersControl.BaseLayer>
            
            <LayersControl.BaseLayer name="Satélite (Híbrido)">
              <TileLayer
                attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
            </LayersControl.BaseLayer>

            <LayersControl.Overlay checked name="Puntos Hídricos">
              <FeatureGroup>
                <EditControl
                  position="topright"
                  onCreated={(e: any) => {
                    if (!session) return;
                    const { layer } = e;
                    const geojson = layer.toGeoJSON();
                    
                    const newPoint = {
                      id: crypto.randomUUID(),
                      user_id: session.user.id,
                      nombre: "Nuevo Punto",
                      sector: "",
                      quebrada: "",
                      rio: "",
                      notas: "",
                      tipo_geometria: geojson.geometry.type,
                      geojson: geojson,
                      created_at: new Date().toISOString()
                    };

                    setTempLayer(layer);
                    setSelectedPunto(newPoint);
                    setEditForm(newPoint);
                    setIsEditing(true);
                  }}
                  draw={{
                    rectangle: false,
                    circle: false,
                    circlemarker: false,
                  }}
                />
                {puntos.map(p => (
                  <GeoJSON 
                    key={p.id} 
                    data={p.geojson} 
                    eventHandlers={{
                      click: () => setSelectedPunto(p)
                    }}
                  >
                    <Popup>
                      <div className="p-1">
                        <h3 className="font-bold text-blue-700 m-0">{p.nombre}</h3>
                        <p className="text-[10px] text-gray-500 m-0 mb-2">{p.sector}</p>
                        <div className="text-[11px] space-y-1">
                          <p><strong>Quebrada:</strong> {p.quebrada}</p>
                          <p><strong>Río:</strong> {p.rio}</p>
                        </div>
                      </div>
                    </Popup>
                  </GeoJSON>
                ))}
              </FeatureGroup>
            </LayersControl.Overlay>
          </LayersControl>
        </MapContainer>
      </main>
    </div>
  );
}

