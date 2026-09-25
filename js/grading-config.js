export const GRADING_CONFIG={
  weights:{centering:.30,corners:.25,edges:.25,surface:.20},
  minPhotoConfidence:.35,
  severeDefectCaps:{crease:6,majorCorner:6.5,majorEdge:6.5,majorSurface:6},
  thresholds:{
    majorCornerScore:4.2,
    majorEdgeScore:4.0,
    majorSurfaceScore:4.8,
    highGlareRatio:.04,
    lowSharpnessVariance:80
  },
  professionalDisclaimer:"Questa è una stima fotografica non ufficiale e non sostituisce una valutazione fisica effettuata da un grading service."
};
