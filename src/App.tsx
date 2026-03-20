import './lib/wallet';
import { useAppStore } from './stores/appStore';
import { useBinanceWS } from './hooks/useBinanceWS';
import { useMarketData } from './hooks/useMarketData';
import { useWalletData } from './hooks/useWalletData';
import { useVwapAndVolatility } from './hooks/useVwapAndVolatility';
import { useSignalsAndArbs } from './hooks/useSignalsAndArbs';
import { useBidAskWS } from './hooks/useBidAskWS';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { DraggableCanvas } from './components/DraggableCanvas';
import { OrderbookPopup } from './components/OrderbookPopup';
import { CreateProgDialog } from './components/CreateProgDialog';
import { EditProgDialog } from './components/EditProgDialog';
import { ArbDialog } from './components/ArbDialog';
import { PnlDrilldownDialog } from './components/PnlDrilldownDialog';
import { SigningDialog } from './components/SigningDialog';
import { SignatureExplainerDialog } from './components/SignatureExplainerDialog';

function PnlDrilldownGlobal() {
  const { open, asset, endDates } = useAppStore((s) => s.pnlDrilldown);
  const close = useAppStore((s) => s.closePnlDrilldown);
  return <PnlDrilldownDialog open={open} asset={asset} endDates={endDates} onClose={close} />;
}

function App() {
  const loading = useAppStore((s) => s.loading);

  useBinanceWS();
  useVwapAndVolatility();
  useSignalsAndArbs();
  useBidAskWS();
  const { refreshData } = useMarketData();
  useWalletData();

  return (
    <div className="gradient-bg h-full flex flex-col text-white" style={{ marginLeft: 288 }}>
      {/* Header - static at top */}
      <div className="flex-shrink-0 px-3 pt-2 pb-1">
        <Header onRefresh={refreshData} />
      </div>

      {/* Main content area */}
      <div className="flex-1 min-h-0 flex">
        {/* Canvas area */}
        <div className="flex-1 min-h-0 overflow-auto px-2 pb-2">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-500 text-sm pulse">Loading markets...</div>
            </div>
          ) : (
            <DraggableCanvas />
          )}
        </div>
      </div>

      {/* Right Sidebar - fixed overlay */}
      <Sidebar />

      {/* Orderbook hover popup */}
      <OrderbookPopup />

      {/* Create Smart Order Dialog */}
      <CreateProgDialog />

      {/* Edit Smart Order Dialog */}
      <EditProgDialog />

      {/* Arb Confirm Dialog */}
      <ArbDialog />

      {/* PnL Drilldown Dialog */}
      <PnlDrilldownGlobal />

      {/* Signing Dialog */}
      <SigningDialog />
      <SignatureExplainerDialog />

      {/* Toast container */}
      <div id="toastContainer" className="toast-container" />
    </div>
  );
}

export default App;
