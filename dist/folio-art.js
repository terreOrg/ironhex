// Generic, game-original line diagrams. One schematic for every visual
// CLASS, independent of weapon model or named MegaMek variant.
const drawings={
 mech:'<path d="M102 44h36l10 19-13 24h-39L86 63z M87 88h65l18 42-20 52H88l-18-52z M70 96l-27 14-16 65 18 14 26-59 M169 96l28 12 17 66-17 15-28-58 M104 181l-18 51-22 47 25 12 36-62 M137 181l26 50 8 49-28 10-23-66" /><path d="M91 110h60M100 135h44M103 156h41 M99 54h40M29 172l22 9M193 178l20-4M65 277l31 9M139 287l36-2 M103 88l12 13 13-13" /><path d="M107 61h25v12h-25z M104 121h32v18h-32z"/>',
 quad:'<path d="M51 102l35-31h93l29 31-16 66H66z M76 162l-24 43-24 53 25 14 40-48 13-53 M169 163l20 51 31 41-23 19-44-46-13-58 M74 124l-35-3-23 24 18 18 31-8 M182 123l38-1 18 21-19 19-32-7" /><path d="M81 95h92M74 125h113 M103 151h44 M31 254l28 12M189 266l29-10"/><path d="M103 83h31l9 16h-49z"/>',
 vehicle:'<path d="M24 160h198l-11 58H32z M55 160l25-47h104l35 47z M85 113l24-30h52l24 30 M118 83v-30h34v30 M152 63h68 M40 205h166" /><circle cx="58" cy="227" r="17"/><circle cx="104" cy="227" r="17"/><circle cx="151" cy="227" r="17"/><circle cx="198" cy="227" r="17"/><path d="M39 227h172M85 145h71M111 93h39"/>',
 fighter:'<path d="M119 30l25 73 82 84-4 25-85-36-18 88-17-88-85 36-4-25 82-84z M110 66h18l9 50h-36z M55 193l52-28M185 193l-50-28 M102 233l17-9 18 9" />',
 laser:'<path d="M32 129h167l16 24-16 26H32z M60 128V99h122v29 M91 99V75h52v24 M32 153h167M52 179l-8 35h55l13-35 M155 179l16 35h41l-10-35 M200 138h24v26h-24" /><circle cx="182" cy="153" r="10"/><path d="M55 116h115M69 142h75M67 165h75M106 85h28 M18 141h14 M18 165h14"/>',
 ballistic:'<path d="M28 122h150v47H28z M48 109h96v13 M178 135h42v22h-42z M75 169v43h55v-43 M101 212v28 M65 240h110 M141 169l21 33h32 M39 139h116M39 154h116"/><circle cx="168" cy="146" r="17"/><path d="M20 133h17M20 157h17 M96 214h23"/>',
 missile:'<path d="M41 67h157l17 33v111H25V100z M42 102h156 M40 176h161 M62 81h20M110 81h20M159 81h20"/><circle cx="69" cy="125" r="18"/><circle cx="120" cy="125" r="18"/><circle cx="171" cy="125" r="18"/><circle cx="69" cy="177" r="18"/><circle cx="120" cy="177" r="18"/><circle cx="171" cy="177" r="18"/><path d="M34 206h179M97 211v22h55v-22"/>',
 machinegun:'<path d="M31 112h149v28H31z M179 117h45v17h-45 M67 142v48l-24 32h24l27-36v-44 M100 143v51h39v-51 M145 142l15 31h24l-10-31 M114 194l17 39M91 233h58"/><path d="M40 119h120 M41 132h120 M95 162h37 M52 220h40 M157 177h27"/>',
 ppc:'<path d="M33 132h141l24 26-24 27H33z M55 131V102h132v29 M78 102l12-25h72l12 25 M43 152h133 M43 171h131 M65 186v32h55l13-32 M153 186l14 33h48" /><ellipse cx="189" cy="158" rx="25" ry="39"/><path d="M191 119l-14 27 13 13-12 25 14 13 M20 144h14M20 176h14"/>',
 cooling:'<path d="M50 59h153v174H50z M60 72h133v148H60z M77 85v122M98 85v122M119 85v122M140 85v122M161 85v122M181 85v122 M42 100h-20v113h28 M203 118h20v83h-20" /><path d="M57 57l14-24h95l23 24 M70 234v20h112v-20"/>',
 hatchet:'<path d="M70 240l97-165 22 10-100 168z M173 52l29-26 21 64-17 62-37-14-18-32 31-17z M74 241l26 15-13 22-29-14z M169 138l37 14M183 79l37 10"/>',
 ammo:'<path d="M37 97h167v147H37z M49 112h143 M49 228h143 M60 90l18-36h28l15 36 M129 90l17-36h27l17 36 M57 147h131M57 184h131"/><circle cx="83" cy="165" r="14"/><circle cx="124" cy="165" r="14"/><circle cx="164" cy="165" r="14"/>',
 system:'<path d="M57 66h126v170H57z M75 83h90v134H75z M89 106h62M89 130h62M89 154h62 M88 178h63 M98 52h44v14M97 236v25h46v-25" /><circle cx="120" cy="191" r="13"/>'
};
const NS='http://www.w3.org/2000/svg';
export function unitArtworkKind(kind,config=''){
 const k=String(kind||'').toLowerCase();
 if(k==='meks')return String(config||'').toLowerCase()==='quad'?'quad':'mech';
 if(k==='vehicles'||k==='battlefieldsupport')return 'vehicle';
 if(/fighter|dropship|smallcraft|warship|jumpship|spacestation/.test(k))return 'fighter';
 if(/protomek/.test(k))return 'quad';
 return 'mech';
}
export function createFolioSchematic(kind='mech'){
 const chosen=Object.hasOwn(drawings,kind)?kind:'system';
 const frame=document.createElement('figure');
 frame.className='folio-illustration';
 const svg=document.createElementNS(NS,'svg');
 svg.setAttribute('viewBox','0 0 240 310');
 svg.setAttribute('role','img');
 svg.setAttribute('aria-label','Условный технический силуэт; не изображение конкретной модели');
 svg.classList.add('folio-line-art');
 const background=document.createElementNS(NS,'rect');
 background.setAttribute('x','8');background.setAttribute('y','8');
 background.setAttribute('width','224');background.setAttribute('height','294');
 background.setAttribute('rx','3');background.setAttribute('class','folio-art-outline');
 svg.append(background);
 const mechanics=document.createElementNS(NS,'g');
 mechanics.setAttribute('fill','none');
 mechanics.setAttribute('stroke','#554735');
 mechanics.setAttribute('stroke-width','3.2');
 mechanics.setAttribute('stroke-linecap','round');
 mechanics.setAttribute('stroke-linejoin','round');
 mechanics.innerHTML=drawings[chosen]; // trusted static SVG paths only
 svg.append(mechanics);
 const caption=document.createElement('figcaption');
 caption.textContent='УСЛОВНАЯ СХЕМА · НЕ ОФИЦИАЛЬНЫЙ ОБЛИК';
 frame.append(svg,caption);
 return frame;
}
