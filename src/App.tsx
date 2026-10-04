import React, { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { Wallet, LogOut, CheckCircle, Search, Clock, FileText, ChevronRight, AlertCircle, Shield, Zap, ArrowRight, ChevronDown, ChevronUp, Globe, Repeat, CreditCard } from 'lucide-react';
import axios from 'axios';
import { motion } from 'framer-motion';
import { CONFIG, CROIN_ABI } from './config';

// TypeScript Declarations
declare global {
  interface Window {
    ethereum?: any;
  }
}

// EIP-6963 Standard Interfaces
interface EIP6963ProviderDetail {
  info: {
    uuid: string;
    name: string;
    icon: string;
    rdns: string;
  };
  provider: any;
}

// ---------------------------------------------------------
// MATH UTILITIES
// ---------------------------------------------------------
// 1 CR = 10^18 wei. 1 mCR = 10^15 wei.
const formatToMilliUnits = (rawWei: bigint | string): string => ethers.formatUnits(rawWei, 15);
const parseFromMilliUnits = (milliString: string): bigint => ethers.parseUnits(milliString, 15);

// ---------------------------------------------------------
// MAIN APP COMPONENT
// ---------------------------------------------------------
export default function App() {
  const [address, setAddress] = useState<string>('');
  const [crBalance, setCrBalance] = useState<string>('0');
  const [jwt, setJwt] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'home' | 'accredits' | 'determine' | 'settle' | 'actuate'>('home');
  const [isConnecting, setIsConnecting] = useState(false);
  
  // Wallet Provider State
  const [walletProvider, setWalletProvider] = useState<any>(null);
  const [wallets, setWallets] = useState<EIP6963ProviderDetail[]>([]);
  const [showWalletModal, setShowWalletModal] = useState(false);

  // Auto-reconnect on load if token exists
  useEffect(() => {
    const savedToken = localStorage.getItem('croin_jwt');
    const savedAddress = localStorage.getItem('croin_address');
    if (savedToken && savedAddress && window.ethereum) {
      setJwt(savedToken);
      setAddress(savedAddress);
      setWalletProvider(window.ethereum);
      fetchBalance(savedAddress);
    }
  }, []);

  // Listen for EIP-6963 Wallets injected into the browser
  useEffect(() => {
    function onAnnounceProvider(event: any) {
      setWallets(prev => {
        if (prev.some(w => w.info.uuid === event.detail.info.uuid)) return prev;
        return [...prev, event.detail];
      });
    }
    window.addEventListener("eip6963:announceProvider", onAnnounceProvider);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounceProvider);
  }, []);

  const connectWallet = async (selectedProvider: any) => {
    setShowWalletModal(false);
    setIsConnecting(true);
    
    try {
      // 1. Force the account request directly on the explicitly selected provider
      await selectedProvider.request({ method: 'eth_requestAccounts' });

      // 2. Switch/Add Robinhood Network
      try {
        await selectedProvider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: CONFIG.NETWORK.chainId }],
        });
      } catch (switchError: any) {
        if (switchError.code === 4902) {
          await selectedProvider.request({
            method: 'wallet_addEthereumChain',
            params: [CONFIG.NETWORK],
          });
        }
      }

      // 3. Connect Provider & Get Address - Using "any" prevents network caching errors
      const provider = new ethers.BrowserProvider(selectedProvider, "any");
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();

      // 4. Sign-In With Ethereum (SIWE) - EIP-4361 Standard Formatting
      const domain = window.location.host;
      const origin = window.location.origin;
      const nonce = Date.now().toString(); 
      const issuedAt = new Date().toISOString();
      const chainIdNumeric = parseInt(CONFIG.NETWORK.chainId, 16); 
      
      const message = `${domain} wants you to sign in with your Ethereum account:\n${userAddress}\n\nSign in to Croin Protocol.\n\nURI: ${origin}\nVersion: 1\nChain ID: ${chainIdNumeric}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
      
      const signature = await signer.signMessage(message);

      // 5. Authenticate with Backend
      const response = await axios.post(`${CONFIG.API_URL}/auth/verify`, {
        address: userAddress,
        signature,
        message
      });

      const token = response.data.token;
      
      // Save state
      setJwt(token);
      setAddress(userAddress);
      setWalletProvider(selectedProvider);
      localStorage.setItem('croin_jwt', token);
      localStorage.setItem('croin_address', userAddress);
      
      fetchBalance(userAddress);
      setActiveTab('accredits');
    } catch (err: any) {
      console.error("Login Error:", err);
      
      if (err.response && err.response.status === 404) {
        alert(`Backend API not found (404). \n\nEnsure your server.js is running and CONFIG.API_URL is correct.\nCurrent URL: ${CONFIG.API_URL}`);
      } else if (err.code === 'ERR_NETWORK') {
        alert(`Network Error: Cannot reach backend server. \n\nEnsure node server.js is running on port 3001.\nCurrent URL: ${CONFIG.API_URL}`);
      } else {
        alert(err?.info?.error?.message || err.message || 'Connection or authentication failed.');
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const fetchBalance = async (userAddress: string) => {
    try {
      if (!window.ethereum) return;
      const provider = new ethers.BrowserProvider(window.ethereum, "any");
      const contract = new ethers.Contract(CONFIG.CONTRACTS.CROIN, CROIN_ABI, provider);
      const balance = await contract.balanceOf(userAddress);
      setCrBalance(formatToMilliUnits(balance));
    } catch (err) {
      console.error("Error fetching balance", err);
    }
  };

  const logout = () => {
    setJwt('');
    setAddress('');
    setCrBalance('0');
    setActiveTab('home');
    localStorage.removeItem('croin_jwt');
    localStorage.removeItem('croin_address');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-lime-500 selection:text-zinc-900">
      {/* NAVBAR */}
      <nav className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('home')}>
              <img src="/logo.png" alt="Croin Logo" className="w-8 h-8 object-contain" />
              <span className="font-bold text-xl tracking-tight text-zinc-100">Croin</span>
            </div>
            
            {address && (
              <div className="flex items-center space-x-4">
                <div className="hidden md:flex space-x-6 mr-4">
                  <button onClick={() => setActiveTab('accredits')} className={`text-sm font-medium transition-colors ${activeTab === 'accredits' ? 'text-lime-400' : 'text-zinc-400 hover:text-amber-500'}`}>Accredits</button>
                  <button onClick={() => setActiveTab('determine')} className={`text-sm font-medium transition-colors ${activeTab === 'determine' ? 'text-lime-400' : 'text-zinc-400 hover:text-amber-500'}`}>Determine</button>
                  <button onClick={() => setActiveTab('settle')} className={`text-sm font-medium transition-colors ${activeTab === 'settle' ? 'text-lime-400' : 'text-zinc-400 hover:text-amber-500'}`}>Settle</button>
                  <button onClick={() => setActiveTab('actuate')} className={`text-sm font-medium transition-colors ${activeTab === 'actuate' ? 'text-lime-400' : 'text-zinc-400 hover:text-amber-500'}`}>Actuate</button>
                </div>

                <div className="flex flex-col items-end mr-4">
                  <span className="text-xs text-zinc-400">Balance</span>
                  <span className="text-sm font-mono text-lime-400">{Number(crBalance).toLocaleString()} mCR</span>
                </div>
                
                <div className="flex items-center space-x-2 bg-zinc-900 border border-zinc-800 rounded-full px-3 py-1.5">
                  <div className="w-2 h-2 rounded-full bg-lime-500 animate-pulse"></div>
                  <span className="text-sm font-mono text-zinc-300">
                    {address.substring(0, 6)}...{address.substring(38)}
                  </span>
                </div>
                
                <button onClick={logout} className="p-2 text-zinc-400 hover:text-amber-500 transition-colors rounded-full hover:bg-zinc-900">
                  <LogOut size={18} />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT AREA */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!address ? (
          <HomeView openWalletModal={() => setShowWalletModal(true)} isConnecting={isConnecting} />
        ) : (
          <>
            {activeTab === 'home' && <HomeView openWalletModal={() => setShowWalletModal(true)} isConnecting={isConnecting} />}
            {activeTab === 'accredits' && <AccreditsView address={address} jwt={jwt} walletProvider={walletProvider} />}
            {activeTab === 'determine' && <DetermineView jwt={jwt} walletProvider={walletProvider} />}
            {activeTab === 'settle' && <SettleView address={address} jwt={jwt} />}
            {activeTab === 'actuate' && <ActuateView address={address} jwt={jwt} walletProvider={walletProvider} />}
          </>
        )}
      </main>

      {/* WALLET SELECTION MODAL */}
      {showWalletModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-6 shadow-2xl relative">
            <button onClick={() => setShowWalletModal(false)} className="absolute top-4 right-4 text-zinc-500 hover:text-white">
              ✕
            </button>
            <h3 className="text-xl font-bold text-white text-center">Connect Wallet</h3>
            
            {wallets.length > 0 ? (
              <div className="space-y-3">
                {wallets.map((wallet) => (
                  <button 
                    key={wallet.info.uuid}
                    onClick={() => connectWallet(wallet.provider)}
                    className="w-full flex items-center gap-4 p-4 rounded-xl bg-zinc-950/50 hover:bg-zinc-800 border border-zinc-800 hover:border-lime-500/50 transition-all group"
                  >
                    <img src={wallet.info.icon} alt={wallet.info.name} className="w-10 h-10 rounded-lg group-hover:scale-110 transition-transform" />
                    <span className="font-semibold text-zinc-200 group-hover:text-white">{wallet.info.name}</span>
                  </button>
                ))}
              </div>
            ) : (
               window.ethereum ? (
                 <div className="space-y-3">
                   <button 
                     onClick={() => connectWallet(window.ethereum)}
                     className="w-full flex items-center gap-4 p-4 rounded-xl bg-zinc-950/50 hover:bg-zinc-800 border border-zinc-800 hover:border-lime-500/50 transition-all"
                   >
                     <div className="w-10 h-10 rounded-lg bg-amber-500 flex items-center justify-center"><Wallet className="text-zinc-950" /></div>
                     <span className="font-semibold text-zinc-200">Browser Wallet (Legacy)</span>
                   </button>
                 </div>
               ) : (
                 <div className="text-center text-zinc-500 py-4">No wallets detected. Please install MetaMask.</div>
               )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------
// HOME VIEW
// ---------------------------------------------------------
function HomeView({ openWalletModal, isConnecting }: { openWalletModal: () => void, isConnecting: boolean }) {
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  const howItWorksRef = useRef<HTMLElement>(null);
  const videosRef = useRef<HTMLElement>(null);
  const faqRef = useRef<HTMLElement>(null);
  const usecaseRef = useRef<HTMLElement>(null);

  const scrollToSection = (ref: React.RefObject<HTMLElement | null>) => {
  ref.current?.scrollIntoView({ behavior: 'smooth' });
};

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  const toggleFaq = (index: number) => {
    setExpandedFaq(expandedFaq === index ? null : index);
  };

  const faqItems = [
    {
      question: "How is Croin beneficial for me?",
      answer: "You can execute conditional payments with Croin that transfer funds only if specific conditions are satisfied. This trustless escrow mechanism is technically called a 'credit'."
    },
    {
      question: "How can I use the credit functionality?",
      answer: "Ask your trading partners if they are keen to receive funds that are secured in an escrow protocol based on certain conditions. Generate a credit & share the Credit ID with them so they can begin fulfillment. Both parties can update the terms status on the Settle page."
    },
    {
      question: "What is essential to generate a credit?",
      answer: "You and the debitor must have EVM-compatible wallet addresses (like MetaMask). You must have enough CR in your wallet, along with some RBH tokens for Robinhood Chain gas fees. You define the validity period and, most importantly, the exact terms in plain English."
    },
    {
      question: "Does Croin have all the functionalities of a typical crypto token?",
      answer: "Yes. Like a standard ERC-20 token, you can transfer CR to others, hold it, and provide liquidity in decentralized exchanges."
    },
    {
      question: "Who can use Croin?",
      answer: "An EVM (Robinhood Chain) address is mandatory. If you don't want to use the conditional credit functionality, you can simply hold CR in any decentralized Web3 wallet."
    },
    {
      question: "For whom can a credit be generated?",
      answer: "Anyone with an EVM-compatible address. Wallet creation takes seconds. They must be willing to interact with the Settle page of this dApp to update proof of fulfillment against the terms."
    },
    {
      question: "What if CR price falls between the credit generation & credit settlement?",
      answer: "Suppose, you generated a 1000 CR credit while CR is worth 1 USDG, but the price falls to 0.95 USDG during settlement. Seemingly your trade partner gets $50 less than what you froze while credit generation. In such a case, you can claim the balance (CR worth $50 in this case) through the compensation pool. Croin has a compensation pool of 150 million CR."
    }
  ];

  const videos = [
    {
      id: "video1",
      embedId: "Gk7EziJu-70",  
      title: "Trade Finance with Croin",
      description: "Croin offers all the trade financing services at your fingertip, faster & cheaper. Croin is a superior alternative to letters of credit, documentary collections, pre-export or import loans, factoring, and export credits."
    },
    {
      id: "video2",
      embedId: "P7PfH7-Imqw", 
      title: "What's Special About Croin?",
      description: "Croin facilitates credit generation and conditional transactions in addition to typical transaction & allowance. Such functions make it completely different from other cryptocurrencies."
    },
    {
      id: "video3",
      embedId: "HsSGjc95dxQ", 
      title: "Benefits of Using Croin in Commerce",
      description: "Fee of conditional payments is 0.5% with Croin, while banks mostly charge 1.5% or more. Additionally, Croin is faster, accessible to all, transparent & trustless. It involves no formalities & paperwork."
    },
    {
      id: "video4",
      embedId: "aDZVJmATC5w", 
      title: "Walkthrough: Brief overview",
      description: "This video demonstrates the actual credit generation through the Croin dApp by a normal user. You just need a Web3 wallet, no registration is needed. You can pay in terms of CR."
    }
  ];

  return (
    <div className="flex flex-col w-full -mt-8">
      {/* Hero Section */}
      <section className="relative min-h-[90vh] flex flex-col items-center justify-center p-4 overflow-hidden border-b border-zinc-800">
        <div className="absolute inset-0 bg-zinc-950 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(132,204,22,0.1),rgba(255,255,255,0))] z-0"></div>
        
        <motion.div
          initial={{ opacity: 0, y: -50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center z-10 w-full max-w-4xl"
        >
          <img src="/logo.png" alt="Croin Logo" className="w-36 h-36 mx-auto mb-4 drop-shadow-[0_0_20px_rgba(245,158,11,0.2)] object-contain" />

          <h1 className="text-5xl md:text-6xl font-extrabold text-white mb-6 tracking-tight">
            Welcome to <span className="text-transparent bg-clip-text bg-gradient-to-r from-lime-400 to-lime-600">Croin</span>
          </h1>
          <p className="text-xl text-zinc-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            The first Layer-2 blockchain solution with built-in credit functionality. Facilitating global commerce through secure, transparent conditional payments on the Robinhood Chain.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={openWalletModal}
              disabled={isConnecting}
              className="bg-amber-500 text-zinc-950 px-8 py-4 rounded-full font-bold shadow-[0_0_20px_rgba(245,158,11,0.2)] hover:bg-amber-400 transition duration-300 flex items-center justify-center disabled:opacity-50"
            >
              {isConnecting ? 'Authenticating...' : 'Login with Wallet'}
              {!isConnecting && <ArrowRight className="ml-2 w-5 h-5" />}
            </motion.button>
            
            <motion.a
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              href="https://drive.google.com/file/"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-zinc-900 text-zinc-300 border-2 border-zinc-700 px-8 py-4 rounded-full font-bold hover:bg-zinc-800 hover:text-white transition duration-300 flex items-center justify-center"
            >
              See Whitepaper
              <FileText className="ml-2 w-5 h-5" />
            </motion.a>
          </div>

          <div className="flex flex-wrap gap-3 justify-center mt-12">
            <button onClick={() => scrollToSection(usecaseRef)} className="bg-zinc-900 text-zinc-400 border border-zinc-800 px-6 py-2.5 rounded-full text-sm font-semibold hover:text-lime-400 hover:border-lime-500/30 transition duration-300">
              Utilities
            </button>
            <button onClick={() => scrollToSection(howItWorksRef)} className="bg-zinc-900 text-zinc-400 border border-zinc-800 px-6 py-2.5 rounded-full text-sm font-semibold hover:text-lime-400 hover:border-lime-500/30 transition duration-300">
              USP
            </button>
            <button onClick={() => scrollToSection(videosRef)} className="bg-zinc-900 text-zinc-400 border border-zinc-800 px-6 py-2.5 rounded-full text-sm font-semibold hover:text-lime-400 hover:border-lime-500/30 transition duration-300">
              Videos
            </button>
            <button onClick={() => scrollToSection(faqRef)} className="bg-zinc-900 text-zinc-400 border border-zinc-800 px-6 py-2.5 rounded-full text-sm font-semibold hover:text-lime-400 hover:border-lime-500/30 transition duration-300">
              FAQ
            </button>
          </div>
        </motion.div>
        
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 0.8 }}
          className="absolute bottom-8 left-0 right-0 flex justify-center"
        >
          <div className="animate-bounce">
            <ChevronDown className="w-8 h-8 text-zinc-600" />
          </div>
        </motion.div>
      </section>

      {/* Benefits Section */}
      <section className="py-24 px-4 bg-zinc-950 border-b border-zinc-800/50">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-white mb-16">The Web3 Banking & Boolean DAO</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <BenefitCard
              number="01"
              title="Secure & Fast Transactions"
              description="Blockchain-based security ensures tamper-proof contracts and transparent terms for all parties involved. Settles instantly on Layer 2."
              color="from-lime-500/10 to-lime-500/5 border-lime-500/20 text-lime-400"
            />
            <BenefitCard
              number="02"
              title="Affordable & Trustless"
              description="Available to everyone through a standard Web3 wallet, democratizing global trade. No need for authoritative execution or banks."
              color="from-amber-500/10 to-amber-500/5 border-amber-500/20 text-amber-500"
            />
            <BenefitCard
              number="03"
              title="Foundation for Web3 Apps"
              description="Provides a Boolean output based on the input in general English. Other protocols can use this feature with their native logic."
              color="from-zinc-500/10 to-zinc-500/5 border-zinc-500/20 text-zinc-300"
            />
          </div>
        </div>
      </section>
      
      {/* Use Cases Section */}
      <section ref={usecaseRef} className="py-24 px-4 bg-zinc-950">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-white mb-4">Real-World Applications</h2>
          <p className="text-center text-zinc-400 mb-16 max-w-3xl mx-auto">
            Croin's intrinsic credit feature based on specified terms enables a variety of powerful use cases across industries.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <UseCaseCard 
              imageSrc="/trade-finance.png"
              title="Trade Financing"
              description="Create conditional payments serving as a blockchain alternative to letters of credit, pre-export loans, and factoring."
              idealFor="International trade, import/export, domestic trade"
            />
            <UseCaseCard 
              imageSrc="/nft-validation.png"
              title="NFT/RWA Validation"
              description="Verify whether the blockchain or digital assets have the actual real-life existence as being claimed on the smart contract."
              idealFor="NFTs, collectibles, property tokenization"
            />
            <UseCaseCard 
              imageSrc="/project-delivery.png"
              title="Safeguarding Project Delivery"
              description="Ensure contractors and clients meet agreed-upon milestones with automated, conditional fund release based on verification."
              idealFor="Construction, IT services, consulting, tenders"
            />
            <UseCaseCard 
              imageSrc="/dao-boolean.png"
              title="DAO for Boolean Output"
              description="Consider decentralized autonomous organizations that make true/false decisions based on general terms for automated execution."
              idealFor="Third party apps, community governance, protocol management"
            />
            <UseCaseCard 
              imageSrc="/betting.png"
              title="Secure Betting System"
              description="Enable transparent, secure betting with automatic settlement based on verified outcomes, eliminating the need for trusted third parties."
              idealFor="Sports betting, prediction markets, gaming"
            />
            
            {/* The Boolean Advantage Highlights */}
            <motion.div 
              whileHover={{ y: -5 }}
              className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-lg p-8"
            >
              <h3 className="text-2xl font-bold text-white mb-4">The Boolean Advantage</h3>
              <p className="text-zinc-400 mb-6 text-sm leading-relaxed">
                These massive industrial use cases are powered by Croin's ability to produce verified Boolean (True/False) outputs based on logical terms specified in plain English.
              </p>
              <ul className="space-y-3">
                <li className="flex items-center text-zinc-300 text-sm">
                  <div className="w-4 h-4 rounded-full border border-lime-500/50 flex items-center justify-center mr-3">
                    <div className="w-2 h-2 rounded-full bg-lime-400"></div>
                  </div> Transparent conditions
                </li>
                <li className="flex items-center text-zinc-300 text-sm">
                  <div className="w-4 h-4 rounded-full border border-amber-500/50 flex items-center justify-center mr-3">
                    <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                  </div> Automated verification
                </li>
                <li className="flex items-center text-zinc-300 text-sm">
                  <div className="w-4 h-4 rounded-full border border-lime-500/50 flex items-center justify-center mr-3">
                    <div className="w-2 h-2 rounded-full bg-lime-400"></div>
                  </div> Trustless execution
                </li>
                <li className="flex items-center text-zinc-300 text-sm">
                  <div className="w-4 h-4 rounded-full border border-amber-500/50 flex items-center justify-center mr-3">
                    <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                  </div> Human-readable terms
                </li>
              </ul>
            </motion.div>
          </div>

          {/* CTA Button */}
          <div className="mt-16 text-center">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => scrollToSection(howItWorksRef)}
              className="bg-zinc-900 border border-zinc-700 text-white px-8 py-4 rounded-full font-bold shadow-lg hover:bg-zinc-800 hover:border-lime-500/50 transition duration-300 inline-flex items-center"
            >
              Explore All Use Cases
              <ArrowRight className="ml-2 w-5 h-5" />
            </motion.button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 px-4 bg-zinc-950 border-t border-zinc-800/50">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-white mb-16">Transforming Global Commerce</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <FeatureCard
              icon={<CreditCard className="w-10 h-10 text-lime-400" />}
              title="Built-in Credit System"
              description="Revolutionary conditional payment that enables trade partners to conduct business with confidence and security, much faster, cheaper and effortless."
            />
            <FeatureCard
              icon={<Globe className="w-10 h-10 text-amber-500" />}
              title="Cross-Border Solutions"
              description="Eliminate intermediaries and follow the community consensus on the credit terms. Facilitate global trade with execution at your fingertips."
            />
            <FeatureCard
              icon={<Repeat className="w-10 h-10 text-lime-400" />}
              title="Sustainable Ecosystem"
              description="Balanced tokenomics with a robust compensation pool and liquidity incentives ensures network stability and permanence."
            />
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section ref={howItWorksRef} className="py-24 px-4 bg-zinc-900 border-y border-zinc-800">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-white mb-6">Use the inbuilt credit with Croin</h2>
          <p className="text-center text-zinc-400 mb-16 max-w-3xl mx-auto">
            You can use Croin (CR) as any other cryptocurrency to buy, hold, transfer, and liquidate. But the true power lies in making conditional payments where funds are released only if the terms are met.
          </p>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="bg-zinc-950 rounded-2xl p-8 border border-zinc-800 shadow-2xl flex items-center justify-center min-h-[400px]">
               {/* Fallback diagram for "how-it-works.png" */}
               <div className="text-zinc-600 text-center space-y-4">
                  <Shield size={64} className="mx-auto text-amber-500/50" />
                  <p className="font-mono text-sm uppercase tracking-widest">Croin Process Flow</p>
               </div>
            </div>
            
            <div className="space-y-8">
              <StepItem number="1" title="Get Connected" description="Install MetaMask or any EIP-6963 compatible wallet. Connect to the Robinhood Chain and log in instantly without registration." />
              <StepItem number="2" title="Generate Credit" description="Define your terms in plain English, set a validity period, and lock your principal amount (CR or USDG) in the smart contract." />
              <StepItem number="3" title="Share & Fulfill" description="Share the resulting Credit ID with your trade partner. They can review the terms and begin fulfilling their obligations." />
              <StepItem number="4" title="Fulfill Terms" description="Use the Settle module to upload proof of delivery. Authorized trustees will evaluate the evidence and cast a transparent on-chain vote." />
              <StepItem number="5" title="Automatic Settlement" description="Based on the updates, consensus of the trustees occurs. Eventually the smart contract automatically releases funds to the correct party." />
            </div>
          </div>
        </div>
      </section>

      {/* Video Section */}
      <section ref={videosRef} className="py-24 px-4 bg-zinc-950">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-white mb-16">Protocol Education</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {videos.map((video) => (
              <div key={video.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-lg hover:border-lime-500/30 transition-colors">
                <div className="aspect-w-16 aspect-h-9 relative bg-black">
                  <iframe
                    className="w-full h-64 md:h-80"
                    src={`https://www.youtube.com/embed/${video.embedId}`}
                    title={video.title}
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  ></iframe>
                </div>
                <div className="p-8">
                  <h3 className="text-xl font-bold text-white mb-3">{video.title}</h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">{video.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Ready to Enter CTA */}
      <section className="py-20 px-4 bg-gradient-to-br from-amber-600/20 to-amber-900/20 text-white border-y border-amber-500/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
        <div className="container mx-auto text-center relative z-10">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
            <h2 className="text-4xl font-bold mb-6 tracking-tight">Ready to Enter the Next Gen Web3?</h2>
            <p className="text-xl text-amber-200/80 mb-10 max-w-3xl mx-auto">
              Join the future of blockchain commerce with Croin
            </p>
            <div className="flex flex-col sm:flex-row justify-center space-y-4 sm:space-y-0 sm:space-x-6">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={openWalletModal}
                disabled={isConnecting}
                className="bg-amber-500 text-zinc-950 px-8 py-4 rounded-full font-bold shadow-[0_0_20px_rgba(245,158,11,0.2)] hover:bg-amber-400 transition duration-300 flex items-center justify-center disabled:opacity-50"
              >
                {isConnecting ? 'Authenticating...' : 'Get Started Now'}
                {!isConnecting && <ArrowRight className="ml-2 w-5 h-5" />}
              </motion.button>
              <motion.a
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                href="https://drive.google.com/file/d/1XlotIblJt5AocsQHrm824tmKCxH_jELu/view?usp=sharing"
                target="_blank"
                rel="noopener noreferrer"
                className="border-2 border-amber-500/50 text-amber-500 hover:text-amber-400 hover:border-amber-400 px-8 py-4 rounded-full font-bold transition duration-300 flex items-center justify-center"
              >
                Learn More
                <FileText className="ml-2 w-5 h-5" />
              </motion.a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Getting Started Section */}
      <section className="py-24 px-4 bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-4xl mx-auto bg-zinc-950 border border-amber-500/20 p-10 rounded-3xl shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
          
          <h2 className="text-3xl font-bold text-white mb-8 relative z-10">Getting Started with Croin</h2>
          
          <ol className="space-y-6 text-zinc-300 mb-10 relative z-10">
            {isMobile ? (
              <>
                <li className="flex gap-4 items-center bg-zinc-900/50 p-4 rounded-xl border border-zinc-800"><div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center font-bold">1</div> Install MetaMask on your mobile device.</li>
                <li className="flex gap-4 items-center bg-zinc-900/50 p-4 rounded-xl border border-zinc-800"><div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center font-bold">2</div> Open this web app inside the MetaMask browser.</li>
                <li className="flex gap-4 items-center bg-zinc-900/50 p-4 rounded-xl border border-zinc-800"><div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center font-bold">3</div> Tap "Login with Wallet" to authenticate to the Robinhood Chain.</li>
              </>
            ) : (
              <>
                <li className="flex gap-4 items-center bg-zinc-900/50 p-4 rounded-xl border border-zinc-800"><div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center font-bold">1</div> Install MetaMask (or any Web3 Wallet) as a browser extension.</li>
                <li className="flex gap-4 items-center bg-zinc-900/50 p-4 rounded-xl border border-zinc-800"><div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center font-bold">2</div> Add and switch to the Robinhood Chain network.</li>
                <li className="flex gap-4 items-center bg-zinc-900/50 p-4 rounded-xl border border-zinc-800"><div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center font-bold">3</div> Click the "Login with Wallet" button at the top of the page.</li>
              </>
            )}
          </ol>
          
          <div className="flex justify-start relative z-10">
            <button onClick={openWalletModal} className="text-zinc-950 bg-amber-500 hover:bg-amber-400 px-8 py-4 rounded-xl font-bold transition-all flex items-center">
              Connect Wallet Now <ArrowRight className="ml-2 w-5 h-5" />
            </button>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section ref={faqRef} className="py-24 px-4 bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-white mb-12">Frequently Asked Questions</h2>
          
          <div className="space-y-4">
            {faqItems.map((item, index) => (
              <div key={index} className="border border-zinc-800 rounded-xl bg-zinc-900 overflow-hidden">
                <button
                  className="w-full px-6 py-5 text-left font-bold flex justify-between items-center text-zinc-200 hover:bg-zinc-800 transition-colors duration-200"
                  onClick={() => toggleFaq(index)}
                >
                  {item.question}
                  {expandedFaq === index ? <ChevronUp className="w-5 h-5 text-lime-500" /> : <ChevronDown className="w-5 h-5 text-zinc-500" />}
                </button>
                {expandedFaq === index && (
                  <div className="px-6 py-5 bg-zinc-950 border-t border-zinc-800">
                    <p className="text-zinc-400 leading-relaxed">{item.answer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-zinc-950 py-12 px-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center">
          <div className="mb-6 md:mb-0 flex items-center gap-3">
            <img src="/logo.png" alt="Croin Logo" className="w-12 h-12 object-contain" />
            <span className="font-bold text-2xl tracking-tight text-white">Croin</span>
          </div>
          
          <div className="text-center md:text-right">
            <p className="text-zinc-500 text-sm mb-4">© {new Date().getFullYear()} Croin. All rights reserved.</p>
            <div className="flex space-x-6 justify-center md:justify-end">
              <a href="https://x.com/CroinOut" target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-amber-500 transition-colors">Twitter</a>
              <a href="#" className="text-zinc-400 hover:text-amber-500 transition-colors">Discord</a>
              <a href="https://t.me/croinCR" target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-amber-500 transition-colors">Telegram</a>
              <a href="https://medium.com" target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-amber-500 transition-colors">Medium</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Sub-components for HomeView
const FeatureCard = ({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) => (
  <motion.div whileHover={{ y: -5 }} className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl text-center hover:border-lime-500/30 transition-colors">
    <div className="inline-flex items-center justify-center w-20 h-20 bg-zinc-950 border border-zinc-800 rounded-full mb-6 shadow-inner">
      {icon}
    </div>
    <h3 className="text-xl font-bold text-white mb-4">{title}</h3>
    <p className="text-zinc-400 leading-relaxed">{description}</p>
  </motion.div>
);

const BenefitCard = ({ number, title, description, color }: { number: string, title: string, description: string, color: string }) => (
  <motion.div whileHover={{ y: -5 }} className={`relative rounded-2xl overflow-hidden bg-gradient-to-br ${color} border p-8`}>
    <span className="text-6xl font-black opacity-20 absolute top-4 right-6">{number}</span>
    <h3 className="text-2xl font-bold mb-4 relative z-10">{title}</h3>
    <p className="opacity-90 relative z-10 leading-relaxed">{description}</p>
  </motion.div>
);

const UseCaseCard = ({ imageSrc, title, description, idealFor }: { imageSrc: string, title: string, description: string, idealFor: string }) => (
  <motion.div whileHover={{ y: -5 }} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden transition-all duration-300 hover:border-amber-500/30">
    <div className="h-48 bg-zinc-950 flex items-center justify-center border-b border-zinc-800 p-4 relative">
      <img src={imageSrc} alt={title} className="max-h-full max-w-full object-contain opacity-70 absolute scale-75" onError={(e) => (e.currentTarget.style.display = 'none')} />
    </div>
    <div className="p-8">
      <h3 className="text-xl font-bold text-white mb-3">{title}</h3>
      <p className="text-zinc-400 text-sm mb-6 leading-relaxed">{description}</p>
      <div className="bg-zinc-950/50 border border-zinc-800/50 p-3 rounded-lg text-xs text-amber-500 font-medium leading-relaxed">
        <span className="text-zinc-500 block mb-1 uppercase tracking-wider text-[10px]">Ideal For</span>
        {idealFor}
      </div>
    </div>
  </motion.div>
);

const StepItem = ({ number, title, description }: { number: string, title: string, description: string }) => (
  <div className="flex items-start">
    <div className="flex-shrink-0 bg-zinc-900 border border-zinc-700 text-lime-400 w-12 h-12 rounded-xl flex items-center justify-center font-bold text-xl mr-6 shadow-inner">
      {number}
    </div>
    <div>
      <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
      <p className="text-zinc-400 leading-relaxed">{description}</p>
    </div>
  </div>
);

// ---------------------------------------------------------
// ACCREDITS VIEW
// ---------------------------------------------------------
function AccreditsView({ address, jwt, walletProvider }: { address: string, jwt: string, walletProvider: any }) {
  const [subTab, setSubTab] = useState<'generate' | 'find' | 'history'>('generate');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <h2 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
          <FileText className="text-amber-500" /> Accredits Module
        </h2>
        
        <div className="flex bg-zinc-900 rounded-lg p-1 border border-zinc-800">
          <button onClick={() => setSubTab('generate')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${subTab === 'generate' ? 'bg-zinc-800 text-lime-400 shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}>Generate</button>
          <button onClick={() => setSubTab('find')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${subTab === 'find' ? 'bg-zinc-800 text-lime-400 shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}>Find ID</button>
          <button onClick={() => setSubTab('history')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${subTab === 'history' ? 'bg-zinc-800 text-lime-400 shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}>History</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8">
          {subTab === 'generate' && <GenerateForm address={address} jwt={jwt} walletProvider={walletProvider} />}
          {subTab === 'find' && <FindForm jwt={jwt} />}
          {subTab === 'history' && <HistoryList jwt={jwt} />}
        </div>
        
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 space-y-3">
             <h3 className="text-sm font-bold text-zinc-300 flex items-center gap-2 uppercase tracking-wider">
               <AlertCircle size={16} className="text-amber-500" /> Information
             </h3>
             <p className="text-xs text-zinc-400 leading-relaxed">
               All amounts are entered in <span className="text-lime-400 font-mono">mCR</span> or <span className="text-lime-400 font-mono">mUSDG</span> (Milli-Units). 
               <br/>1,000 mCR equals 1 CR. 
             </p>
             <p className="text-xs text-zinc-400 leading-relaxed">
               Executing a generation requires a wallet signature and Robinhood Chain gas. Ensure you have RBH tokens to pay for gas.
             </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// GENERATE CREDIT FORM
// ---------------------------------------------------------
function GenerateForm({ address, jwt, walletProvider }: { address: string, jwt: string, walletProvider: any }) {
  const [loading, setLoading] = useState(false);
  const [successId, setSuccessId] = useState<string | null>(null);
  
  const [debitor, setDebitor] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [validity, setValidity] = useState('');
  const [ballotinId, setBallotinId] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [dEmail, setDEmail] = useState('');
  const [message, setMessage] = useState('');
  const [terms, setTerms] = useState('');
  const [useUsdg, setUseUsdg] = useState(false);

  const [calculatedFeeStr, setCalculatedFeeStr] = useState('0');

  useEffect(() => {
    if (!amountStr || isNaN(Number(amountStr))) {
      setCalculatedFeeStr('0');
      return;
    }
    try {
      const amountWei = parseFromMilliUnits(amountStr);
      let feeWei = (amountWei * BigInt(CONFIG.FEES.DEFAULT_FEE_RATIO)) / BigInt(100000);
      
      if (feeWei < CONFIG.FEES.MIN_FEE_AMOUNT_WEI) {
        feeWei = CONFIG.FEES.MIN_FEE_AMOUNT_WEI;
      }
      
      setCalculatedFeeStr(formatToMilliUnits(feeWei));
    } catch {
      setCalculatedFeeStr('Invalid Amount');
    }
  }, [amountStr]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!terms) return alert("Terms are mandatory.");
    setLoading(true);
    setSuccessId(null);

    try {
      if (!walletProvider) throw new Error("Wallet not connected");
      
      const provider = new ethers.BrowserProvider(walletProvider, "any");
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONFIG.CONTRACTS.CROIN, CROIN_ABI, signer);

      const amountWei = parseFromMilliUnits(amountStr);
      
      const tx = await contract.generateCredit(debitor, amountWei, validity, ballotinId, useUsdg);
      const receipt = await tx.wait();
      
      let newCreditId = 'Unknown';
      for (const log of receipt.logs) {
        try {
          const parsedLog = contract.interface.parseLog(log);
          if (parsedLog && parsedLog.name === 'CreditGenerated') {
            newCreditId = parsedLog.args[0].toString();
          }
        } catch (e) { /* ignore unrelated logs */ }
      }

      const payload = {
        creditId: newCreditId,
        creditor: address,
        debitor,
        amount: amountWei.toString(),
        fee: parseFromMilliUnits(calculatedFeeStr).toString(),
        ballotinId,
        validity,
        creditorEmail: cEmail,
        debitorEmail: dEmail,
        message,
        terms
      };

      await axios.post(`${CONFIG.API_URL}/credits`, payload, {
        headers: { Authorization: `Bearer ${jwt}` }
      });

      setSuccessId(newCreditId);
      setDebitor(''); setAmountStr(''); setValidity(''); setBallotinId('');
      setCEmail(''); setDEmail(''); setMessage(''); setTerms('');

    } catch (err: any) {
      console.error(err);
      alert(err.reason || err.message || 'Transaction failed');
    } finally {
      setLoading(false);
    }
  };

  if (successId) {
    return (
      <div className="bg-zinc-900 border border-lime-500/30 rounded-xl p-8 text-center space-y-4">
        <CheckCircle className="w-16 h-16 text-lime-400 mx-auto" />
        <h3 className="text-2xl font-bold text-white">Credit Activated Successfully</h3>
        <p className="text-zinc-400">Saved to blockchain and database.</p>
        <div className="inline-block bg-zinc-950 border border-zinc-800 rounded-lg px-6 py-3 font-mono text-xl text-amber-500">
          Credit ID: #{successId}
        </div>
        <div>
          <button onClick={() => setSuccessId(null)} className="mt-4 text-lime-400 hover:underline">Generate Another</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleGenerate} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5 shadow-lg">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        
        <div className="space-y-1">
          <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Creditor (You)</label>
          <input type="text" value={address} disabled className="w-full bg-zinc-950/50 border border-zinc-800 text-zinc-500 rounded-lg px-4 py-2 cursor-not-allowed font-mono text-sm" />
        </div>
        
        <div className="space-y-1">
          <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Debitor Address *</label>
          <input required type="text" placeholder="0x..." value={debitor} onChange={e => setDebitor(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 text-zinc-100 rounded-lg px-4 py-2 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 font-mono text-sm transition-all" />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide flex justify-between">
            <span>Principal Amount *</span>
            <div className="flex gap-2 items-center">
              <span className="text-[10px]">USDG</span>
              <input type="checkbox" checked={useUsdg} onChange={e => setUseUsdg(e.target.checked)} className="accent-amber-500" />
            </div>
          </label>
          <div className="relative">
            <input required type="number" step="any" min="0" placeholder="e.g. 50" value={amountStr} onChange={e => setAmountStr(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 text-zinc-100 rounded-lg px-4 py-2 pr-16 focus:outline-none focus:border-lime-500 focus:ring-1 focus:ring-lime-500 font-mono text-sm transition-all" />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-500">{useUsdg ? 'mUSDG' : 'mCR'}</span>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide flex justify-between">
            <span>Protocol Fee</span>
            <span className="text-amber-500">Auto-calc</span>
          </label>
          <div className="relative">
             <input type="text" value={calculatedFeeStr} readOnly className="w-full bg-amber-950/20 border border-amber-900/50 text-amber-500 rounded-lg px-4 py-2 pr-12 font-mono text-sm" />
             <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-amber-700">mCR</span>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Validity (Days) *</label>
          <input required type="number" min="1" value={validity} onChange={e => setValidity(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 text-zinc-100 rounded-lg px-4 py-2 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
        </div>
        
        <div className="space-y-1">
          <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Ballotin ID *</label>
          <input required type="number" min="1" value={ballotinId} onChange={e => setBallotinId(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 text-zinc-100 rounded-lg px-4 py-2 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Creditor Email</label>
          <input type="email" value={cEmail} onChange={e => setCEmail(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 text-zinc-100 rounded-lg px-4 py-2 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
        </div>
        
        <div className="space-y-1">
          <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Debitor Email</label>
          <input type="email" value={dEmail} onChange={e => setDEmail(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 text-zinc-100 rounded-lg px-4 py-2 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
        </div>
      </div>
      
      <div className="space-y-1">
        <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Message / Memo</label>
        <textarea rows={2} value={message} onChange={e => setMessage(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 text-zinc-100 rounded-lg px-4 py-2 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 resize-none"></textarea>
      </div>
      
      <div className="space-y-1">
        <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Terms *</label>
        <textarea required rows={3} placeholder="Define exact conditions for the ballotin decision..." value={terms} onChange={e => setTerms(e.target.value)} className="w-full bg-zinc-950 border border-lime-500/50 text-zinc-100 rounded-lg px-4 py-2 focus:outline-none focus:border-lime-500 focus:ring-1 focus:ring-lime-500 resize-none"></textarea>
      </div>

      <button disabled={loading} type="submit" className="w-full py-4 rounded-lg bg-lime-500 hover:bg-lime-400 text-zinc-950 font-bold tracking-wide transition-all shadow-[0_0_15px_rgba(132,204,22,0.2)] disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2 mt-4">
        {loading ? <div className="w-5 h-5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin"></div> : <CheckCircle size={20} />}
        {loading ? 'Awaiting Wallet Signature...' : 'Generate Credit'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------
// FIND CREDIT FORM
// ---------------------------------------------------------
function FindForm({ jwt }: { jwt: string }) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  
  const [creditor, setCreditor] = useState('');
  const [debitor, setDebitor] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [ballotinId, setBallotinId] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const amountWei = parseFromMilliUnits(amountStr);
      const res = await axios.get(`${CONFIG.API_URL}/credits/find`, {
        params: { creditor, debitor, amount: amountWei.toString(), ballotinId },
        headers: { Authorization: `Bearer ${jwt}` }
      });
      setResults(res.data);
    } catch (err) {
      console.error(err);
      alert('Search failed. Check your API server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSearch} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
        <h3 className="font-bold text-amber-500 border-b border-zinc-800 pb-2 mb-4">Search Constraints</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input required type="text" placeholder="Creditor Address" value={creditor} onChange={e=>setCreditor(e.target.value)} className="bg-zinc-950 border border-zinc-700 text-zinc-100 rounded-lg px-4 py-2 font-mono text-sm" />
          <input required type="text" placeholder="Debitor Address" value={debitor} onChange={e=>setDebitor(e.target.value)} className="bg-zinc-950 border border-zinc-700 text-zinc-100 rounded-lg px-4 py-2 font-mono text-sm" />
          <input required type="number" step="any" placeholder="Amount (mCR/mUSDG)" value={amountStr} onChange={e=>setAmountStr(e.target.value)} className="bg-zinc-950 border border-zinc-700 text-zinc-100 rounded-lg px-4 py-2 font-mono text-sm" />
          <input required type="number" placeholder="Ballotin ID" value={ballotinId} onChange={e=>setBallotinId(e.target.value)} className="bg-zinc-950 border border-zinc-700 text-zinc-100 rounded-lg px-4 py-2" />
        </div>
        <button disabled={loading} type="submit" className="w-full py-3 mt-4 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-medium transition-colors border border-zinc-700 flex justify-center items-center gap-2">
          {loading ? 'Searching...' : <><Search size={18} /> Find Credit ID</>}
        </button>
      </form>

      {results.length > 0 && (
        <div className="bg-zinc-900 border border-lime-500/30 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-950/50">
            <h3 className="font-bold text-lime-400">Found {results.length} Match(es)</h3>
          </div>
          <div className="divide-y divide-zinc-800">
            {results.map((r, i) => (
              <div key={i} className="p-6 flex justify-between items-center hover:bg-zinc-800/50 transition-colors cursor-pointer">
                <div>
                  <div className="text-xl font-mono font-bold text-white mb-1">ID: #{r.credit_id}</div>
                  <div className="text-sm text-zinc-400 flex gap-4">
                     <span>Created: {new Date(r.created_at).toLocaleDateString()}</span>
                     <span className="text-amber-500">{r.status}</span>
                  </div>
                </div>
                <ChevronRight className="text-zinc-600" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------
// CREDIT HISTORY LIST
// ---------------------------------------------------------
function HistoryList({ jwt }: { jwt: string }) {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    axios.get(`${CONFIG.API_URL}/credits/history`, {
      headers: { Authorization: `Bearer ${jwt}` }
    })
    .then(res => setHistory(res.data))
    .catch(err => console.error(err))
    .finally(() => setLoading(false));
  }, [jwt]);

  if (loading) return <div className="text-center py-20 text-zinc-500 animate-pulse">Loading history...</div>;
  if (history.length === 0) return <div className="text-center py-20 text-zinc-500 bg-zinc-900 rounded-xl border border-zinc-800">No generated credits found for this wallet.</div>;

  return (
    <div className="space-y-4">
      {history.map((credit, i) => (
        <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-amber-500/50 transition-colors group cursor-pointer">
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center font-mono font-bold text-lime-400 group-hover:scale-110 transition-transform">
                #{credit.credit_id}
              </div>
              <div>
                <div className="text-xs text-zinc-500 font-medium tracking-wide uppercase">Amount</div>
                <div className="text-lg font-bold text-white font-mono">{formatToMilliUnits(credit.amount)} {credit.isUsdg ? 'mUSDG' : 'mCR'}</div>
              </div>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${credit.status === 'Activated' ? 'bg-lime-500/10 text-lime-400 border border-lime-500/20' : 'bg-zinc-800 text-zinc-400'}`}>
              {credit.status}
            </div>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mt-4 p-4 bg-zinc-950/50 rounded-lg border border-zinc-800/50">
            <div>
              <div className="text-zinc-500 text-xs mb-1">Debitor</div>
              <div className="font-mono text-zinc-300 truncate" title={credit.debitor}>
                {credit.debitor.substring(0,6)}...{credit.debitor.substring(38)}
              </div>
            </div>
            <div>
              <div className="text-zinc-500 text-xs mb-1">Ballotin ID</div>
              <div className="font-mono text-zinc-300">#{credit.ballotin_id}</div>
            </div>
            <div>
              <div className="text-zinc-500 text-xs mb-1 flex items-center gap-1"><Clock size={12}/> Validity</div>
              <div className="text-zinc-300">{credit.validity} Days</div>
            </div>
            <div>
              <div className="text-zinc-500 text-xs mb-1">Date Generated</div>
              <div className="text-zinc-300">{new Date(credit.created_at).toLocaleDateString()}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------
// DETERMINE VIEW (VOTING MODULE)
// ---------------------------------------------------------
function DetermineView({ jwt, walletProvider }: { jwt: string, walletProvider: any }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [creditIdInput, setCreditIdInput] = useState('');
  const [creditData, setCreditData] = useState<any>(null);
  const [decision, setDecision] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');

  const handleValidate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditIdInput) return;
    
    setLoading(true);
    setError('');
    
    try {
      const res = await axios.get(`${CONFIG.API_URL}/determine/validate/${creditIdInput}`, {
        headers: { Authorization: `Bearer ${jwt}` }
      });
      
      setCreditData(res.data);
      setStep(2); 
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || 'Validation failed. Ensure the Credit ID exists and you are a trustee.');
    } finally {
      setLoading(false);
    }
  };

  const handleVote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (decision === null) return setError('Please select a decision.');
    if (!reason.trim()) return setError('Please provide a reason for your decision.');
    
    setLoading(true);
    setError('');

    try {
      if (!walletProvider) throw new Error("Wallet not connected");
      const provider = new ethers.BrowserProvider(walletProvider, "any");
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONFIG.CONTRACTS.CROIN, CROIN_ABI, signer);

      const tx = await contract.vote(creditIdInput, decision);
      await tx.wait();

      await axios.post(`${CONFIG.API_URL}/decisions`, {
        creditId: creditIdInput,
        decision,
        reason
      }, {
        headers: { Authorization: `Bearer ${jwt}` }
      });

      setStep(3); 
    } catch (err: any) {
      console.error(err);
      setError(err.reason || err.message || 'Transaction failed or rejected by wallet.');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setStep(1);
    setCreditIdInput('');
    setCreditData(null);
    setDecision(null);
    setReason('');
    setError('');
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <h2 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
          <Shield className="text-lime-500" /> Determine Module
        </h2>
        <span className="text-sm font-mono text-zinc-500">Trustee Validation</span>
      </div>

      {error && (
        <div className="bg-red-950/50 border border-red-900 text-red-400 p-4 rounded-xl flex items-start gap-3">
          <AlertCircle className="shrink-0 mt-0.5" size={18} />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {step === 1 && (
        <form onSubmit={handleValidate} className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 space-y-6 shadow-lg text-center animate-fade-in">
          <Shield size={48} className="text-zinc-700 mx-auto mb-2" />
          <h3 className="text-xl font-bold text-white">Trustee Access Portal</h3>
          <p className="text-zinc-400 text-sm max-w-md mx-auto">
            Enter the Credit ID you wish to vote on. The system will verify if your connected wallet is a registered trustee for this ballotin.
          </p>
          
          <div className="max-w-xs mx-auto space-y-4">
            <input 
              required 
              type="number" 
              placeholder="Credit ID" 
              value={creditIdInput} 
              onChange={e => setCreditIdInput(e.target.value)} 
              className="w-full bg-zinc-950 border border-zinc-700 text-zinc-100 rounded-lg px-4 py-3 text-center font-mono text-lg focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" 
            />
            <button 
              disabled={loading || !creditIdInput} 
              type="submit" 
              className="w-full py-3 rounded-lg bg-lime-500 hover:bg-lime-400 text-zinc-950 font-bold tracking-wide transition-all shadow-[0_0_15px_rgba(132,204,22,0.2)] disabled:opacity-50 disabled:shadow-none flex justify-center items-center gap-2"
            >
              {loading ? <div className="w-5 h-5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin"></div> : 'Validate & Access'}
            </button>
          </div>
        </form>
      )}

      {step === 2 && creditData && (
        <form onSubmit={handleVote} className="space-y-6 animate-fade-in">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-bold text-amber-500 uppercase tracking-wider border-b border-zinc-800 pb-2">Credit Details</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-zinc-500 mb-1">Credit ID</div>
                <div className="font-mono text-zinc-200">#{creditData.credit_id}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500 mb-1">Amount</div>
                <div className="font-mono font-bold text-lime-400">{formatToMilliUnits(creditData.amount)} mCR</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500 mb-1">Ballotin ID</div>
                <div className="font-mono text-zinc-200">#{creditData.ballotin_id}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500 mb-1">Validity</div>
                <div className="text-zinc-200">{creditData.validity} Days</div>
              </div>
            </div>
            
            <div className="bg-zinc-900 p-4 rounded-lg border border-zinc-800/50 mt-4">
              <div className="text-xs text-zinc-500 mb-1">Agreed Terms</div>
              <p className="text-sm text-zinc-300 italic">"{creditData.terms}"</p>
            </div>
          </div>

          <div className="bg-zinc-900 border border-lime-500/30 rounded-xl p-6 space-y-6 shadow-lg">
            <h3 className="text-xl font-bold text-white">Cast Your Vote</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setDecision(true)}
                className={`py-4 rounded-xl border-2 transition-all font-bold text-lg flex items-center justify-center gap-2 ${decision === true ? 'border-lime-500 bg-lime-500/10 text-lime-400' : 'border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-700'}`}
              >
                <CheckCircle size={20} /> Approve (True)
              </button>
              <button
                type="button"
                onClick={() => setDecision(false)}
                className={`py-4 rounded-xl border-2 transition-all font-bold text-lg flex items-center justify-center gap-2 ${decision === false ? 'border-red-500 bg-red-500/10 text-red-400' : 'border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-700'}`}
              >
                <AlertCircle size={20} /> Reject (False)
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Reasoning *</label>
              <textarea 
                required 
                rows={4} 
                placeholder="Explain your governance decision..." 
                value={reason} 
                onChange={e => setReason(e.target.value)} 
                className="w-full bg-zinc-950 border border-zinc-700 text-zinc-100 rounded-lg px-4 py-3 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 resize-none"
              ></textarea>
            </div>

            <button 
              disabled={loading} 
              type="submit" 
              className="w-full py-4 rounded-lg bg-lime-500 hover:bg-lime-400 text-zinc-950 font-bold tracking-wide transition-all shadow-[0_0_15px_rgba(132,204,22,0.2)] disabled:opacity-50 disabled:shadow-none flex justify-center items-center gap-2"
            >
              {loading ? <div className="w-5 h-5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin"></div> : 'Cast Vote via Wallet'}
            </button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="bg-zinc-900 border border-lime-500/30 rounded-xl p-10 text-center space-y-6 shadow-lg animate-fade-in">
          <CheckCircle className="w-20 h-20 text-lime-400 mx-auto" />
          <div>
            <h3 className="text-3xl font-bold text-white mb-2">Vote Recorded</h3>
            <p className="text-zinc-400 max-w-sm mx-auto">
              Your decision has been secured on the Robinhood Chain and your reasoning saved to the governance database.
            </p>
          </div>
          <button 
            onClick={resetForm} 
            className="px-6 py-3 border border-zinc-700 rounded-lg text-zinc-300 hover:text-white hover:bg-zinc-800 transition-all font-medium mt-4"
          >
            Assess Another Credit
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------
// SETTLE VIEW (DISPUTE & CHAT MODULE)
// ---------------------------------------------------------
function SettleView({ address, jwt }: { address: string, jwt: string }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [creditIdInput, setCreditIdInput] = useState('');
  const [role, setRole] = useState<string>('');
  const [chatExists, setChatExists] = useState<boolean>(false);
  
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [showNotification, setShowNotification] = useState(false);
  const chatEndRef = React.useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleProceed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditIdInput) return;
    
    setLoading(true);
    setError('');
    
    try {
      const res = await axios.get(`${CONFIG.API_URL}/settle/validate/${creditIdInput}`, {
        headers: { Authorization: `Bearer ${jwt}` },
        params: { adminAddress: CONFIG.ADMIN_ADDRESS }
      });
      
      setRole(res.data.role);
      setChatExists(res.data.chatExists);
      
      if (res.data.chatExists) {
        await loadChat(creditIdInput);
      }
      
      setStep(2);
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || 'Validation failed. Ensure Credit ID is correct.');
    } finally {
      setLoading(false);
    }
  };

  const loadChat = async (id: string) => {
    try {
      const res = await axios.get(`${CONFIG.API_URL}/settle/chat/${id}`, {
        headers: { Authorization: `Bearer ${jwt}` }
      });
      setMessages(res.data);
    } catch (err) {
      console.error("Failed to load chat", err);
    }
  };

  const handleStartSettlement = async () => {
    setLoading(true);
    try {
      await axios.post(`${CONFIG.API_URL}/settle/chat/init`, { creditId: creditIdInput }, {
        headers: { Authorization: `Bearer ${jwt}` }
      });
      setChatExists(true);
      setShowNotification(true);
      await loadChat(creditIdInput);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to start settlement');
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    
    try {
      const res = await axios.post(`${CONFIG.API_URL}/settle/chat/message`, {
        creditId: creditIdInput,
        message: newMessage,
        role: role
      }, {
        headers: { Authorization: `Bearer ${jwt}` }
      });
      
      setMessages([...messages, res.data]);
      setNewMessage('');
      setShowNotification(false);
    } catch (err) {
      console.error("Failed to send message", err);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <h2 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
          <FileText className="text-lime-500" /> Settle Module
        </h2>
        <span className="text-sm font-mono text-zinc-500">Dispute & Chat Gateway</span>
      </div>

      {error && (
        <div className="bg-red-950/50 border border-red-900 text-red-400 p-4 rounded-xl flex items-start gap-3">
          <AlertCircle className="shrink-0 mt-0.5" size={18} />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      {step === 1 && (
        <form onSubmit={handleProceed} className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 space-y-6 shadow-lg text-center animate-fade-in max-w-md mx-auto">
          <FileText size={48} className="text-zinc-700 mx-auto mb-2" />
          <h3 className="text-xl font-bold text-white">Access Settlement Chat</h3>
          <p className="text-zinc-400 text-sm">
            Enter the Credit ID to load the dispute subcollection. Access is strictly limited to authorized parties.
          </p>
          
          <div className="space-y-4">
            <input 
              required 
              type="number" 
              placeholder="Credit ID" 
              value={creditIdInput} 
              onChange={e => setCreditIdInput(e.target.value)} 
              className="w-full bg-zinc-950 border border-zinc-700 text-zinc-100 rounded-lg px-4 py-3 text-center font-mono text-lg focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" 
            />
            <button 
              disabled={loading || !creditIdInput} 
              type="submit" 
              className="w-full py-3 rounded-lg bg-lime-500 hover:bg-lime-400 text-zinc-950 font-bold tracking-wide transition-all shadow-[0_0_15px_rgba(132,204,22,0.2)] disabled:opacity-50 disabled:shadow-none flex justify-center items-center gap-2"
            >
              {loading ? <div className="w-5 h-5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin"></div> : 'Proceed'}
            </button>
          </div>
        </form>
      )}

      {step === 2 && (
        <div className="space-y-6 animate-fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex justify-between items-center">
            <div>
              <div className="text-xs text-zinc-500 font-bold uppercase tracking-wide mb-1">Credit Chat Interface</div>
              <div className="font-mono text-lg text-white">ID: #{creditIdInput}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-zinc-500 font-bold uppercase tracking-wide mb-1">Your Authenticated Role</div>
              <div className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/10 text-amber-500 border border-amber-500/20 inline-block">
                {role}
              </div>
            </div>
          </div>

          {!chatExists ? (
            <div className="bg-zinc-900 border border-lime-500/30 rounded-xl p-10 text-center space-y-6 shadow-lg">
              <AlertCircle className="w-16 h-16 text-lime-400 mx-auto" />
              <h3 className="text-2xl font-bold text-white">Settlement Not Initialized</h3>
              <p className="text-zinc-400">No communication subcollection exists for this credit yet.</p>
              
              {role === 'Debitor' ? (
                <button 
                  onClick={handleStartSettlement}
                  disabled={loading}
                  className="px-8 py-3 rounded-lg bg-lime-500 hover:bg-lime-400 text-zinc-950 font-bold tracking-wide transition-all mt-4 flex items-center gap-2 mx-auto"
                >
                  {loading ? <div className="w-4 h-4 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin"></div> : 'Start Settlement as Debitor'}
                </button>
              ) : (
                <p className="text-amber-500 text-sm bg-amber-500/10 p-3 rounded-lg border border-amber-500/20 inline-block mt-4">
                  Only the Debitor can initiate the settlement process.
                </p>
              )}
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-lg overflow-hidden flex flex-col h-[600px]">
              
              {showNotification && role === 'Debitor' && (
                <div className="bg-lime-500 text-zinc-950 p-3 text-center text-sm font-bold flex justify-between items-center">
                  <span>Please submit public links of the documents in chatbox. Or write your comments.</span>
                  <button onClick={() => setShowNotification(false)} className="text-zinc-800 hover:text-zinc-950">✕</button>
                </div>
              )}

              <div className="flex-1 p-6 overflow-y-auto space-y-6 bg-zinc-950/50">
                {messages.map((msg, idx) => {
                  const isMe = msg.sender.toLowerCase() === address.toLowerCase();
                  
                  let roleColor = "bg-zinc-800 text-zinc-300";
                  if (msg.sender_role === 'Creditor') roleColor = "bg-blue-500/20 text-blue-400 border border-blue-500/20";
                  if (msg.sender_role === 'Debitor') roleColor = "bg-amber-500/20 text-amber-500 border border-amber-500/20";
                  if (msg.sender_role === 'Trustee') roleColor = "bg-purple-500/20 text-purple-400 border border-purple-500/20";
                  if (msg.sender_role === 'Admin') roleColor = "bg-red-500/20 text-red-400 border border-red-500/20";

                  return (
                    <div key={idx} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} animate-fade-in`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs text-zinc-500">
                          {msg.sender.substring(0, 6)}...{msg.sender.substring(38)}
                        </span>
                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${roleColor}`}>
                          {msg.sender_role}
                        </span>
                      </div>
                      <div className={`max-w-[80%] rounded-2xl p-4 text-sm whitespace-pre-wrap ${
                        isMe 
                          ? 'bg-lime-500 text-zinc-950 rounded-tr-sm shadow-[0_4px_15px_rgba(132,204,22,0.1)]' 
                          : 'bg-zinc-800 text-zinc-200 rounded-tl-sm border border-zinc-700'
                      }`}>
                        {msg.message}
                      </div>
                      <span className="text-[10px] text-zinc-600 mt-1">
                        {new Date(msg.timestamp).toLocaleString()}
                      </span>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>

              <form onSubmit={handleSendMessage} className="p-4 bg-zinc-900 border-t border-zinc-800">
                <div className="flex gap-3 relative">
                  <textarea 
                    value={newMessage}
                    onChange={e => setNewMessage(e.target.value)}
                    placeholder="Type your message or paste public links..."
                    className="flex-1 bg-zinc-950 border border-zinc-700 text-zinc-100 rounded-xl px-4 py-3 pr-24 focus:outline-none focus:border-lime-500 focus:ring-1 focus:ring-lime-500 resize-none h-14"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage(e);
                      }
                    }}
                  />
                  <button 
                    type="submit" 
                    disabled={!newMessage.trim()}
                    className="absolute right-2 top-2 bottom-2 px-6 rounded-lg bg-lime-500 hover:bg-lime-400 text-zinc-950 font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Send
                  </button>
                </div>
                <div className="text-[10px] text-zinc-500 mt-2 text-center">
                  Press Enter to send, Shift + Enter for new line.
                </div>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------
// ACTUATE VIEW (EXECUTION MODULE)
// ---------------------------------------------------------
function ActuateView({ address, jwt, walletProvider }: { address: string, jwt: string, walletProvider: any }) {
  const [creditIdInput, setCreditIdInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<any>(null);

  const handleActuate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditIdInput) return;
    
    setLoading(true);
    setError('');
    setSuccess(null);

    try {
      const tickerRes = await axios.get(`${CONFIG.API_URL}/actuate/ticker/${address}`, {
        headers: { Authorization: `Bearer ${jwt}` }
      });
      
      if (!tickerRes.data.isTicker) {
        throw new Error("Access Denied: You are not an eligible ticker.");
      }

      if (!walletProvider) throw new Error("Wallet not connected");
      const provider = new ethers.BrowserProvider(walletProvider, "any");
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONFIG.CONTRACTS.CROIN, CROIN_ABI, signer);

      const tx = await contract.triggerDecision(creditIdInput);
      const receipt = await tx.wait(); 

      let finalDecision = null;
      for (const log of receipt.logs) {
        try {
          const parsedLog = contract.interface.parseLog(log);
          if (parsedLog && parsedLog.name === 'DecisionTriggered') {
            finalDecision = parsedLog.args[1]; 
          }
        } catch (err) { /* Ignore logs from other contracts */ }
      }

      if (finalDecision === null) {
         console.warn("DecisionTriggered event not found in transaction receipt.");
      }

      await axios.post(`${CONFIG.API_URL}/actuate/complete`, {
        creditId: creditIdInput,
        decision: finalDecision !== null ? finalDecision : false 
      }, {
        headers: { Authorization: `Bearer ${jwt}` }
      });

      setSuccess({
        id: creditIdInput,
        decision: finalDecision
      });
      setCreditIdInput('');

    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || err.reason || err.message || 'Execution failed. Check contract constraints.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <h2 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
          <Zap className="text-amber-500" /> Actuate Module
        </h2>
        <span className="text-sm font-mono text-zinc-500">Ticker Terminal</span>
      </div>

      {error && (
        <div className="bg-red-950/50 border border-red-900 text-red-400 p-4 rounded-xl flex items-start gap-3 animate-fade-in">
          <AlertCircle className="shrink-0 mt-0.5" size={18} />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-zinc-900 border border-lime-500/30 rounded-xl p-8 text-center space-y-4 shadow-lg animate-fade-in">
          <CheckCircle className="w-16 h-16 text-lime-400 mx-auto" />
          <h3 className="text-2xl font-bold text-white">Execution Successful</h3>
          <p className="text-zinc-400">
            Credit #{success.id} has been settled and wiped from active state.
          </p>
          <div className="inline-block bg-zinc-950 border border-zinc-800 rounded-lg px-6 py-3 mt-2">
            <div className="text-xs text-zinc-500 uppercase font-bold tracking-wide mb-1">Final Decision Recorded</div>
            <div className={`font-bold text-xl ${success.decision ? 'text-lime-400' : 'text-red-400'}`}>
              {success.decision ? 'APPROVED (True)' : 'REJECTED (False)'}
            </div>
          </div>
          <div className="pt-4">
            <button onClick={() => setSuccess(null)} className="text-lime-400 hover:underline text-sm font-medium">Actuate Another Credit</button>
          </div>
        </div>
      )}

      {!success && (
        <form onSubmit={handleActuate} className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 space-y-6 shadow-lg text-center animate-fade-in">
          <Zap size={48} className="text-zinc-700 mx-auto mb-2" />
          <h3 className="text-xl font-bold text-white">Execute Final Decision</h3>
          <p className="text-zinc-400 text-sm max-w-md mx-auto">
            Authorized Tickers can trigger the final settlement of a credit. The smart contract will evaluate the votes, distribute funds, and allocate protocol fees.
          </p>
          
          <div className="max-w-xs mx-auto space-y-4 pt-2">
            <input 
              required 
              type="number" 
              placeholder="Credit ID" 
              value={creditIdInput} 
              onChange={e => setCreditIdInput(e.target.value)} 
              className="w-full bg-zinc-950 border border-zinc-700 text-zinc-100 rounded-lg px-4 py-3 text-center font-mono text-lg focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" 
            />
            <button 
              disabled={loading || !creditIdInput} 
              type="submit" 
              className="w-full py-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold tracking-wide transition-all shadow-[0_0_15px_rgba(245,158,11,0.2)] disabled:opacity-50 disabled:shadow-none flex justify-center items-center gap-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>Validate & Actuate</>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}