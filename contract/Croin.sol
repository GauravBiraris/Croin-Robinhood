// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

// OpenZeppelin v5 Standard Libraries 
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Croin Token (Multi-Token Escrow Version)
/// @notice A sustainable token with credit and ballotin functionality supporting USDG stablecoin
//  Croin Version 40 (Dust Handling & Static Quorum Security)

contract Croin is ERC20, ReentrancyGuard {
using SafeERC20 for IERC20;

address public admin;
address[] public tickers;

// External Stablecoin (e.g., Paxos USDG)
IERC20 public usdgToken;

uint256[] private activeBallotinIds;
mapping(uint256 => uint256[]) private ballotinToActiveCredits;

bool private _paused;
bool private _hanged;

// Protocol Constants
uint256 public quorumPercentage = 60;
uint256 public membersShare = 8500;
uint256 public tickerShare = 1000;

// CR Token Fee Parameters
uint256 public feeRatio = 500;
uint256 public minFeeAmount = 40 * 10 ** 18;

// External USDG Token Fee Parameters
uint256 public usdgFeeRatio = 500;
uint256 public usdgMinFeeAmount = 40 * 10 ** 18;

uint256 public nextCreditId = 1;
uint256 public nextBallotinId = 1;

struct Credit {
    uint256 timestamp;
    uint256 amount;
    uint256 fee;
    uint256 validity;
    address creditor;
    address debitor;
    uint256 ballotinId;
    uint256 quorumThreshold; // VULNERABILITY FIX: Static quorum threshold saved at generation
    bool isUsdg; 
    address[] trueVoters;
    address[] falseVoters;
}

mapping(uint256 => Credit) public credits;
mapping(uint256 => address[]) public ballotins;

event TrusteeAdded(uint256 indexed ballotinId, address trustee);
event TrusteeRemoved(uint256 indexed ballotinId, address trustee);
event CreditGenerated(
    uint256 indexed creditId,
    address indexed creditor,
    address indexed debitor,
    uint256 ballotinId,
    uint256 validity,
    uint256 amount,
    uint256 fee,
    bool isUsdg
);

event Voted(address indexed trustee, uint256 creditId);

event BallotinCreated(uint256 indexed ballotinId, uint256 totalActiveBallotins);
event BallotinDeleted(uint256 indexed ballotinId, uint256 totalActiveBallotins);
event DecisionTriggered(
    uint256 indexed creditId,
    bool decision,
    uint256 majorityVoters,
    uint256 trusteeShare,
    uint256 tickerShare
);

constructor() ERC20("Croin", "CR") {
    admin = msg.sender;
    _mint(msg.sender, 1_000_000_000 * 10 ** 18);
}

modifier unHung() {
    require(!_hanged, "This functionality is hanged");
    _;
}

modifier onlyAdmin() {
    require(msg.sender == admin, "Caller is not the admin");
    _;
}

modifier onlyTicker() {
    require(isInArray(tickers, msg.sender), "Caller is not a ticker");
    _;
}

// ==========================================
// Configuration & Admin Functions
// ==========================================

function setUsdgToken(address _usdgAddress, uint256 _feeRatio, uint256 _minFeeAmount) external onlyAdmin {
    require(_usdgAddress != address(0), "Invalid address");
    require(_feeRatio < 50000, "Should be less than 50000");
    usdgToken = IERC20(_usdgAddress);
    usdgFeeRatio = _feeRatio;
    usdgMinFeeAmount = _minFeeAmount;
}

function isInArray(address[] storage array, address account) internal view returns (bool) {
    for (uint i = 0; i < array.length; i++) {
        if (array[i] == account) {
            return true;
        }
    }
    return false;
}

function hanged() public view returns (bool) {
    return _hanged;
}

function hang() external onlyAdmin {
    _hanged = true;
}

function unhang() external onlyAdmin {
    _hanged = false;
}

function paused() public view returns (bool) {
    return _paused;
}

function pause() external onlyAdmin {
    _paused = true;
}

function unpause() external onlyAdmin {
    _paused = false;
}

function addTicker(address ticker) external onlyAdmin {
    require(!isInArray(tickers, ticker), "Already a ticker");
    tickers.push(ticker);
}

function removeTicker(address ticker) external onlyAdmin {
    for (uint i = 0; i < tickers.length; i++) {
        if (tickers[i] == ticker) {
            tickers[i] = tickers[tickers.length - 1];
            tickers.pop();
            return;
        }
    }
    revert("Not a ticker");
}

function mint(address to, uint256 amount) external onlyAdmin returns (bool) {
    require(totalSupply() + amount <= 5_000_000_000 * 10 ** 18, "Cap exceeded");
    _mint(to, amount);
    return true;
}

// ==========================================
// Ballotin Functions
// ==========================================

function createBallotin(address initialTrustee) external onlyAdmin returns (uint256) {
    uint256 ballotinId = nextBallotinId++;
    ballotins[ballotinId].push(initialTrustee);
    activeBallotinIds.push(ballotinId);
    emit BallotinCreated(ballotinId, activeBallotinIds.length);
    emit TrusteeAdded(ballotinId, initialTrustee);
    return ballotinId;
}

function deleteBallotin(uint256 ballotinId) external onlyAdmin {
    require(ballotinId < nextBallotinId, "Invalid ballotin ID");
    require(ballotinToActiveCredits[ballotinId].length == 0, "Cannot delete ballotin with active credits");

    for (uint256 i = 0; i < activeBallotinIds.length; i++) {
        if (activeBallotinIds[i] == ballotinId) {
            activeBallotinIds[i] = activeBallotinIds[activeBallotinIds.length - 1];
            activeBallotinIds.pop();
            break;
        }
    }

    delete ballotins[ballotinId];
    emit BallotinDeleted(ballotinId, activeBallotinIds.length);
}

function getActiveBallotinIds() external view returns (uint256[] memory) {
    return activeBallotinIds;
}

function addTrustee(address trustee, uint256 ballotinId) external onlyAdmin {
    require(ballotinId < nextBallotinId, "Invalid ballotin ID");
    require(ballotins[ballotinId].length > 0, "Ballotin does not exist");
    require(!isTrusteeForBallotin(trustee, ballotinId), "Already a trustee for this ballotin");
    ballotins[ballotinId].push(trustee);
    emit TrusteeAdded(ballotinId, trustee);
}

function removeTrustee(address trustee, uint256 ballotinId) external onlyAdmin {
    require(ballotinId < nextBallotinId, "Invalid ballotin ID");
    require(ballotins[ballotinId].length > 0, "Ballotin does not exist");
    require(isTrusteeForBallotin(trustee, ballotinId), "Not a trustee for this ballotin");
    require(ballotins[ballotinId].length > 1, "Cannot remove the last trustee");

    address[] storage trustees = ballotins[ballotinId];
    for (uint256 i = 0; i < trustees.length; i++) {
        if (trustees[i] == trustee) {
            trustees[i] = trustees[trustees.length - 1];
            trustees.pop();
            emit TrusteeRemoved(ballotinId, trustee);
            break;
        }
    }
}

function isTrusteeForBallotin(address trustee, uint256 ballotinId) public view returns (bool) {
    address[] memory trustees = ballotins[ballotinId];
    for (uint i = 0; i < trustees.length; i++) {
        if (trustees[i] == trustee) {
            return true;
        }
    }
    return false;
}

// ==========================================
// Core Credit Logic
// ==========================================

function isBallotinActive(uint256 ballotinId) public view returns (bool) {
    for (uint256 i = 0; i < activeBallotinIds.length; i++) {
        if (activeBallotinIds[i] == ballotinId) {
            return true;
        }
    }
    return false;
}

/// @notice Generates a new credit using either CR or an external token (USDG) for principal.
function generateCredit(
    address debitor,
    uint256 amount,
    uint256 validity,
    uint256 ballotinId,
    bool useUsdg
) external nonReentrant returns (uint256) {
    require(!_paused, "Croin is paused for now");
    require(isBallotinActive(ballotinId), "Ballotin is not active");

    uint256 scaledAmount = amount;
    uint256 fee;

    if (useUsdg) {
        require(address(usdgToken) != address(0), "USDG token not configured");
        uint8 usdgDecimals = IERC20Metadata(address(usdgToken)).decimals();
        
        // Scale USDG to 18 decimals solely for the purpose of the CR fee calculation
        if (usdgDecimals < 18) {
            scaledAmount = amount * (10 ** (18 - usdgDecimals));
        } else if (usdgDecimals > 18) {
            scaledAmount = amount / (10 ** (usdgDecimals - 18));
        }

        fee = (scaledAmount * usdgFeeRatio) / 100000;
        fee = fee < usdgMinFeeAmount ? usdgMinFeeAmount : fee;

        require(balanceOf(msg.sender) >= fee, "Insufficient CR balance for fee");
        
        // Pull USDG Principal
        usdgToken.safeTransferFrom(msg.sender, address(this), amount);
        // Pull CR Fee internally
        _transfer(msg.sender, address(this), fee);

    } else {
        fee = (scaledAmount * feeRatio) / 100000;
        fee = fee < minFeeAmount ? minFeeAmount : fee;

        require(balanceOf(msg.sender) >= amount + fee, "Insufficient CR balance for principal and fee");
        // Pull both CR Principal and CR Fee internally
        _transfer(msg.sender, address(this), amount + fee);
    }

    // VULNERABILITY FIX: Calculate and lock quorum threshold immediately based on current trustee count
    uint256 currentTrusteeCount = ballotins[ballotinId].length;
    uint256 qThreshold = (currentTrusteeCount * quorumPercentage) / 100;

    uint256 creditId = nextCreditId++;
    Credit storage newCredit = credits[creditId];
    newCredit.timestamp = block.timestamp;
    newCredit.creditor = msg.sender;
    newCredit.debitor = debitor;
    newCredit.amount = amount; // Store unscaled amount for accurate external transfer later
    newCredit.fee = fee;
    newCredit.validity = validity;
    newCredit.ballotinId = ballotinId;
    newCredit.quorumThreshold = qThreshold;
    newCredit.isUsdg = useUsdg;

    ballotinToActiveCredits[ballotinId].push(creditId);

    emit CreditGenerated(creditId, msg.sender, debitor, ballotinId, validity, amount, fee, useUsdg);
    return creditId;
}

function vote(uint256 creditId, bool decision) external {
    Credit storage credit = credits[creditId];
    require(isTrusteeForBallotin(msg.sender, credit.ballotinId), "Not a trustee for this ballotin OR The credit is inactive");
    require(block.timestamp <= credit.timestamp + credit.validity * 1 days, "Validity has been passed");

    for (uint128 i = 0; i < credit.trueVoters.length; i++) {
        require(credit.trueVoters[i] != msg.sender, "Already voted: In support");
    }
    for (uint128 i = 0; i < credit.falseVoters.length; i++) {
        require(credit.falseVoters[i] != msg.sender, "Already voted: Against");
    }

    if (decision) {
        credit.trueVoters.push(msg.sender);
    } else {
        credit.falseVoters.push(msg.sender);
    }
    emit Voted(msg.sender, creditId);
}

function removeCreditFromBallotin(uint256 creditId, uint256 ballotinId) private {
    uint256[] storage activeCredits = ballotinToActiveCredits[ballotinId];
    for (uint256 i = 0; i < activeCredits.length; i++) {
        if (activeCredits[i] == creditId) {
            activeCredits[i] = activeCredits[activeCredits.length - 1];
            activeCredits.pop();
            break;
        }
    }
}

function triggerDecision(uint256 creditId) external onlyTicker unHung nonReentrant {
    Credit storage credit = credits[creditId];
    require(credit.creditor != address(0), "Credit does not exist");
    
    uint256 totalVotes = credit.trueVoters.length + credit.falseVoters.length;
    
    // VULNERABILITY FIX: Use the locked quorum threshold, not dynamically calculated
    uint256 qThreshold = credit.quorumThreshold;

    require(totalVotes >= qThreshold, "Not enough votes for ballotin decision");
    require(credit.trueVoters.length != credit.falseVoters.length, "Double check the credit details, no majority vote.");

    // CEI Pattern: Cache necessary data to memory before deleting state
    bool decision = credit.trueVoters.length > credit.falseVoters.length;
    address[] memory majorityVoters = decision ? credit.trueVoters : credit.falseVoters;
    address recipient = decision ? credit.debitor : credit.creditor;
    uint256 payoutAmount = credit.amount;
    uint256 totalFee = credit.fee;
    bool isUsdg = credit.isUsdg;
    uint256 bId = credit.ballotinId;

    // Calculate CR Fee Distribution
    uint256 membersShareAmount = (totalFee * membersShare) / 10000;
    uint256 tickerShareAmount = (totalFee * tickerShare) / 10000;
    uint256 adminShareAmount = totalFee - membersShareAmount - tickerShareAmount;

    // EFFECTS: Update state and delete data BEFORE external transfers
    removeCreditFromBallotin(creditId, bId);
    delete credits[creditId];

    // INTERACTIONS: Perform all token transfers
    if (isUsdg) {
        usdgToken.safeTransfer(recipient, payoutAmount);
    } else {
        _transfer(address(this), recipient, payoutAmount);
    }

    if (majorityVoters.length > 0) {
        uint256 memberFee = membersShareAmount / majorityVoters.length;
        
        // VULNERABILITY FIX: Collect truncation dust and forward it to admin
        uint256 distributedMemberFees = memberFee * majorityVoters.length;
        adminShareAmount += (membersShareAmount - distributedMemberFees); 

        for (uint256 i = 0; i < majorityVoters.length; i++) {
            _transfer(address(this), majorityVoters[i], memberFee);
        }
    } else {
         adminShareAmount += membersShareAmount;
    }

    _transfer(address(this), msg.sender, tickerShareAmount);
    _transfer(address(this), admin, adminShareAmount);
    
    emit DecisionTriggered(creditId, decision, majorityVoters.length, membersShareAmount, tickerShareAmount);
}

function settleExpiredCredit(uint256 creditId) external onlyTicker unHung nonReentrant {
    Credit storage credit = credits[creditId];
    require(credit.creditor != address(0), "Credit does not exist");
    require(block.timestamp > credit.timestamp + (credit.validity) * 1 days + 1 days, "Not enough time for expiration");
    
    // VULNERABILITY FIX: Use locked quorum threshold
    require(
        credit.trueVoters.length + credit.falseVoters.length < credit.quorumThreshold,
        "Enough Quorum. Decision can be triggered."
    );
    
    // CEI Pattern: Cache data
    uint256 returnAmount = credit.amount;
    uint256 totalFee = credit.fee;
    bool isUsdg = credit.isUsdg;
    address creditor = credit.creditor;
    uint256 bId = credit.ballotinId;

    uint256 tickerShareAmount = (totalFee * tickerShare) / 10000;
    uint256 adminShareAmount = totalFee - tickerShareAmount;

    // EFFECTS: Delete state
    removeCreditFromBallotin(creditId, bId);
    delete credits[creditId];

    // INTERACTIONS: Transfers
    if (isUsdg) {
        usdgToken.safeTransfer(creditor, returnAmount);
    } else {
        _transfer(address(this), creditor, returnAmount);
    }

    _transfer(address(this), admin, adminShareAmount);
    _transfer(address(this), msg.sender, tickerShareAmount);
}

function settleEqualVotes(uint256 creditId) external onlyTicker unHung nonReentrant {
    Credit storage credit = credits[creditId];

    require(credit.creditor != address(0), "Credit does not exist");
    require(block.timestamp > credit.timestamp + credit.validity * 1 days + 1 days, "Validity Has not passed");
    require(credit.trueVoters.length == credit.falseVoters.length, "Typical Decision can be triggered");

    // CEI Pattern: Cache data
    address[] memory allVotedTrustees = new address[](credit.trueVoters.length + credit.falseVoters.length);
    for (uint256 i = 0; i < credit.trueVoters.length; i++) {
        allVotedTrustees[i] = credit.trueVoters[i];
    }
    for (uint256 j = 0; j < credit.falseVoters.length; j++) {
        allVotedTrustees[credit.trueVoters.length + j] = credit.falseVoters[j];
    }

    // VULNERABILITY FIX: Handle odd-number dust for principal splits
    uint256 splitAmount = credit.amount / 2;
    uint256 creditorAmount = credit.amount - splitAmount; // Receives the extra wei if amount is odd

    uint256 totalFee = credit.fee;
    bool isUsdg = credit.isUsdg;
    address creditor = credit.creditor;
    address debitor = credit.debitor;
    uint256 bId = credit.ballotinId;

    uint256 membersShareAmount = (totalFee * membersShare) / 10000;
    uint256 tickerShareAmount = (totalFee * tickerShare) / 10000;
    uint256 adminShareAmount = totalFee - membersShareAmount - tickerShareAmount;

    // EFFECTS: Delete state
    removeCreditFromBallotin(creditId, bId);
    delete credits[creditId];

    // INTERACTIONS: Transfers
    if (isUsdg) {
        usdgToken.safeTransfer(creditor, creditorAmount);
        usdgToken.safeTransfer(debitor, splitAmount);
    } else {
        _transfer(address(this), creditor, creditorAmount);
        _transfer(address(this), debitor, splitAmount);
    }

    if (allVotedTrustees.length > 0) {
        uint256 memberFee = membersShareAmount / allVotedTrustees.length;
        
        // VULNERABILITY FIX: Collect truncation dust and forward it to admin
        uint256 distributedMemberFees = memberFee * allVotedTrustees.length;
        adminShareAmount += (membersShareAmount - distributedMemberFees);

        for (uint256 i = 0; i < allVotedTrustees.length; i++) {
            _transfer(address(this), allVotedTrustees[i], memberFee);
        }
    } else {
        adminShareAmount += membersShareAmount;
    }

    _transfer(address(this), msg.sender, tickerShareAmount);
    _transfer(address(this), admin, adminShareAmount);
}

// ==========================================
// Admin Overrides & Queries
// ==========================================

function changeQuorumRequirement(uint256 newQuorumPercentage) external onlyAdmin unHung {
    require(newQuorumPercentage > 0 && newQuorumPercentage <= 100, "Invalid quorum percentage");
    quorumPercentage = newQuorumPercentage;
}

function refreshCreditId(uint256 newStarting) external onlyAdmin unHung {
    require(_paused, "Croin should be paused for this function.");
    nextCreditId = newStarting;
}

function retrot(uint256 creditId, bool decision) external onlyAdmin {
    Credit storage credit = credits[creditId];
    require(block.timestamp >= credit.timestamp + credit.validity * 1 days + 10 days, "Not 10 days after validity");

    if (decision) {
        credit.trueVoters.push(msg.sender);
    } else {
        credit.falseVoters.push(msg.sender);
    }
    emit Voted(msg.sender, creditId);
}

function changeFeeDistributionRatio(uint256 newMembersShare, uint256 newTickerShare) external onlyAdmin unHung {
    require(newMembersShare + newTickerShare <= 9900, "Total must be <= 9900");
    membersShare = newMembersShare;
    tickerShare = newTickerShare;
}

function multiTransfer(address[] calldata recipients, uint256[] calldata amounts) external {
    require(recipients.length == amounts.length, "Recipients and amounts must have same length");
    for (uint256 i = 0; i < recipients.length; i++) {
        _transfer(msg.sender, recipients[i], amounts[i]);
    }
}

function changeFeeParameters(uint256 newFeeRatio, uint256 newMinFeeAmount) external onlyAdmin unHung {
    require(newFeeRatio < 50000, "Should be less than 50000");
    feeRatio = newFeeRatio;
    minFeeAmount = newMinFeeAmount;
}

function changeUsdgFeeParameters(uint256 newUsdgFeeRatio, uint256 newUsdgMinFeeAmount) external onlyAdmin unHung {
    require(newUsdgFeeRatio < 50000, "Should be less than 50000");
    usdgFeeRatio = newUsdgFeeRatio;
    usdgMinFeeAmount = newUsdgMinFeeAmount;
}

function getCreditDetails(uint256 creditId) external view returns (
    uint256 timestamp,
    address creditor,
    address debitor,
    uint256 amount,
    uint256 fee,
    uint256 validity,
    uint256 ballotinId,
    uint256 quorumThreshold,
    uint256 trueVotes,
    uint256 falseVotes,
    bool isUsdg
) {
    Credit memory credit = credits[creditId];
    require(credit.creditor != address(0), "Credit does not exist");

    return (
        credit.timestamp,
        credit.creditor,
        credit.debitor,
        credit.amount,
        credit.fee,
        credit.validity,
        credit.ballotinId,
        credit.quorumThreshold,
        credit.trueVoters.length,
        credit.falseVoters.length,
        credit.isUsdg
    );
}

function getTrusteeBallotinIds(address trustee) public view unHung returns (uint256[] memory) {
    uint256[] memory ballotinIds = new uint256[](nextBallotinId - 1);
    uint256 count = 0;

    for (uint256 i = 1; i < nextBallotinId; i++) {
        if (isTrusteeForBallotin(trustee, i)) {
            ballotinIds[count] = i;
            count++;
        }
    }

    uint256[] memory result = new uint256[](count);
    for (uint256 i = 0; i < count; i++) {
        result[i] = ballotinIds[i];
    }

    return result;
}

function getBallotinTrusteesCount(uint256 ballotinId) external view returns (uint256) {
    return ballotins[ballotinId].length;
}

function getTickerAddresses() external view unHung returns (address[] memory) {
    return tickers;
}

function _update(address from, address to, uint256 value) internal virtual override {
    require(!_paused, "Token transfer while paused");
    super._update(from, to, value);
}


}