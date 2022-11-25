package test

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"testing"

	_ "github.com/ipld/go-ipld-prime/codec/dagcbor"
	"github.com/ipld/go-ipld-prime/traversal/selector"

	address "github.com/filecoin-project/go-address"
	"github.com/filecoin-project/go-state-types/big"
	"github.com/filecoin-project/specs-actors/v8/actors/builtin"
	"github.com/filecoin-project/specs-actors/v8/actors/states"
	"github.com/filecoin-project/specs-actors/v8/actors/util/adt"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/ipld/go-ipld-prime"
	"github.com/ipld/go-ipld-prime/datamodel"
	cidlink "github.com/ipld/go-ipld-prime/linking/cid"
	"github.com/ipld/go-ipld-prime/node/basicnode"
	"github.com/ipld/go-ipld-prime/traversal"
	"github.com/stretchr/testify/require"

	quarry "github.com/retrieval-markets-lab/das-quarry"
)

type mockBlocks struct {
	data map[cid.Cid]blocks.Block
}

func newMockBlocks() *mockBlocks {
	return &mockBlocks{make(map[cid.Cid]blocks.Block)}
}

func (mb *mockBlocks) Get(ctx context.Context, c cid.Cid) (blocks.Block, error) {
	d, ok := mb.data[c]
	if ok {
		return d, nil
	}
	return nil, fmt.Errorf("not found %s", c)
}

func (mb *mockBlocks) Put(ctx context.Context, b blocks.Block) error {
	mb.data[b.Cid()] = b
	return nil
}

type settableBuffer struct {
	bytes.Buffer
	didSetData bool
	data       []byte
}

func (sb *settableBuffer) SetBytes(data []byte) error {
	sb.didSetData = true
	sb.data = data
	return nil
}

func (sb *settableBuffer) Bytes() []byte {
	if sb.didSetData {
		return sb.data
	}
	return sb.Buffer.Bytes()
}

func TestPartialStateAccess(t *testing.T) {
	bs := newMockBlocks()
	store := adt.WrapBlockStore(context.Background(), bs)
	st, err := states.NewTree(store)
	require.NoError(t, err)

	// Fill the state with a bunch of actors
	for i := 0; i < 10000; i++ {
		a, err := address.NewIDAddress(uint64(i))
		if err != nil {
			t.Fatal(err)
		}

		err = st.SetActor(a, &states.Actor{
			Code:       builtin.StorageMinerActorCodeID,
			Head:       builtin.AccountActorCodeID,
			CallSeqNum: uint64(i),
			Balance:    big.NewIntUnsigned(1258812523 + uint64(i)),
		})
		if err != nil {
			t.Fatal(err)
		}
	}

	root, err := st.Map.Root()
	require.NoError(t, err)

	lsys := cidlink.DefaultLinkSystem()
	lsys.TrustedStorage = true

	openedLinks := []ipld.Link{}

	lsys.StorageReadOpener = func(lnkCtx ipld.LinkContext, lnk ipld.Link) (io.Reader, error) {
		openedLinks = append(openedLinks, lnk)
		asCidLink, ok := lnk.(cidlink.Link)
		if !ok {
			return nil, fmt.Errorf("unsupported link type")
		}

		block, err := bs.Get(lnkCtx.Ctx, asCidLink.Cid)
		if err != nil {
			return nil, err
		}
		return bytes.NewBuffer(block.RawData()), nil
	}
	lsys.StorageWriteOpener = func(lnkCtx ipld.LinkContext) (io.Writer, ipld.BlockWriteCommitter, error) {
		var buffer settableBuffer
		committer := func(lnk ipld.Link) error {
			asCidLink, ok := lnk.(cidlink.Link)
			if !ok {
				return fmt.Errorf("unsupported link type")
			}
			block, err := blocks.NewBlockWithCid(buffer.Bytes(), asCidLink.Cid)
			if err != nil {
				return err
			}
			return bs.Put(lnkCtx.Ctx, block)
		}
		return &buffer, committer, nil
	}

	quarry.AddQuarryReificationToLinkSystem(&lsys)

	rlink := cidlink.Link{Cid: root}
	nd, err := lsys.Load(ipld.LinkContext{}, rlink, basicnode.Prototype.Any)
	require.NoError(t, err)

	prog := traversal.Progress{
		Cfg: &traversal.Config{
			LinkSystem:                     lsys,
			LinkTargetNodePrototypeChooser: basicnode.Chooser,
		},
	}

	addr, err := address.NewIDAddress(uint64(1000))
	require.NoError(t, err)

	s, err := selector.CompileSelector(quarry.FilecoinHamtActorStateSelector(addr))
	require.NoError(t, err)

	if err := prog.WalkMatching(nd, s, func(_ traversal.Progress, n datamodel.Node) error {
		sn, err := n.LookupByIndex(2)
		require.NoError(t, err)
		num, err := sn.AsInt()
		require.NoError(t, err)
		require.Equal(t, int64(1000), num)
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	require.Equal(t, 3, len(openedLinks))
}
